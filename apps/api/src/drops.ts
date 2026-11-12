import { randomInt } from "node:crypto";
import { Claimant, Memo, Operation } from "@stellar/stellar-sdk";
import { normalizeAmount, amountFromUnits, units, TESTNET } from "@stellardrop/shared";
import { db, withLock } from "./db.js";
import { AppError } from "./errors.js";
import { accountBalance, buildTransaction, emailWalletKey, ensureCustodialUser, escrowKey, friendbot, parseTransaction, usdc, userKey } from "./stellar.js";
import { persistJob, runJob, settleSource } from "./ledger.js";
import { verifyWalletSignatures, type Session } from "./auth.js";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function claimCode() { return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(""); }
export function normalizedCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6,8}$/.test(normalized)) throw new AppError(400, "Invalid claim code.");
  return normalized;
}
export async function ensureTrustline(key: ReturnType<typeof escrowKey>) {
  return withLock(`account:${key.publicKey()}`, async () => {
    await settleSource(key.publicKey());
    if ((await accountBalance(key.publicKey())).hasTrustline) return;
    const tx = await buildTransaction(key.publicKey(), [Operation.changeTrust({ asset: usdc })]);
    tx.sign(key);
    const job = await persistJob("TRUSTLINE", key.publicKey(), tx);
    await runJob(job.id);
  });
}
export async function activateEmailWallet(session: Session) {
  const key = await emailWalletKey(session);
  return withLock(`user:${session.userId}`, async () => {
    await friendbot(key.publicKey());
    await ensureTrustline(key);
    return { publicKey: key.publicKey(), ...(await accountBalance(key.publicKey())) };
  });
}
export async function prepareDrop(session: Session, rawAmount: string) {
  let amount: string;
  try { amount = normalizeAmount(rawAmount); } catch (error) { throw new AppError(400, (error as Error).message); }
  await ensureTrustline(escrowKey());
  return withLock(`account:${session.publicKey}`, async () => {
    await settleSource(session.publicKey);
    const wallet = await accountBalance(session.publicKey);
    if (!wallet.funded || !wallet.hasTrustline) throw new AppError(400, "Fund your Testnet wallet and add the USDC trustline first.");
    if (units(wallet.balance) < units(amount)) throw new AppError(400, "Your Testnet USDC balance is too low.");
    const code = claimCode();
    const tx = await buildTransaction(session.publicKey, [
      Operation.payment({ destination: escrowKey().publicKey(), asset: usdc, amount }),
      Operation.createClaimableBalance({ asset: usdc, amount, source: escrowKey().publicKey(), claimants: [new Claimant(escrowKey().publicKey(), Claimant.predicateUnconditional())] }),
    ], Memo.text(`StellarDrop ${code}`));
    const intent = await db.fundingIntent.create({ data: { senderId: session.userId, publicKey: session.publicKey, claimCode: code, amount, unsignedXdr: tx.toXDR(), txHash: Buffer.from(tx.hash()).toString("hex"), expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000) } });
    return { intentId: intent.id, transaction: intent.unsignedXdr, amount, networkPassphrase: TESTNET.passphrase, expiresAt: intent.expiresAt };
  });
}
export async function createDrop(session: Session, input: { amount: string; senderPublicKey: string; intentId: string; signedTransaction?: string }) {
  const intent = await db.fundingIntent.findUnique({ where: { id: input.intentId } });
  if (!intent || intent.senderId !== session.userId || input.senderPublicKey !== session.publicKey || intent.publicKey !== session.publicKey) throw new AppError(403, "Funding intent does not belong to this wallet.");
  let amount: string;
  try { amount = normalizeAmount(input.amount); } catch { throw new AppError(400, "Invalid amount."); }
  if (amount !== intent.amount) throw new AppError(400, "Amount differs from the approved transaction.");
  if (session.authMethod !== "email" && !input.signedTransaction) throw new AppError(400, "An external wallet signature is required.");
  if (session.authMethod === "email" && input.signedTransaction) throw new AppError(400, "Email accounts approve the prepared funding intent directly.");
  const signed = parseTransaction(session.authMethod === "email" ? intent.unsignedXdr : input.signedTransaction!);
  if (Buffer.from(signed.hash()).toString("hex") !== intent.txHash) throw new AppError(400, "The wallet transaction was modified.");
  if (session.authMethod === "email") signed.sign(await emailWalletKey(session));
  else await verifyWalletSignatures(session.publicKey, signed);
  return withLock(`account:${session.publicKey}`, async () => {
    const existing = await db.drop.findUnique({ where: { id: intent.id } });
    if (existing) return existing;
    let job = await db.ledgerJob.findUnique({ where: { kind_reference: { kind: "CREATE", reference: intent.id } } });
    if (!job) {
      if (intent.expiresAt.getTime() < Date.now()) throw new AppError(409, "The signing window expired. Create the drop again.");
      await settleSource(session.publicKey);
      signed.sign(escrowKey());
      job = await persistJob("CREATE", intent.id, signed);
    }
    await runJob(job.id);
    return db.drop.findUniqueOrThrow({ where: { id: intent.id } });
  });
}
export async function claimDrop(code: string, telegramId: string) {
  const drop = await db.drop.findUnique({ where: { claimCode: normalizedCode(code) } });
  if (!drop) throw new AppError(404, "That drop was not found. Check the code with the sender.");
  return withLock(`telegram:${telegramId}`, async () => {
    const user = await ensureCustodialUser(telegramId);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Drop" WHERE id = ${drop.id} FOR UPDATE`;
      const current = await tx.drop.findUniqueOrThrow({ where: { id: drop.id } });
      if (current.status !== "CREATED") {
        if (current.receiverId === user.id) return;
        throw new AppError(409, "This drop has already been claimed.");
      }
      const reservation = await tx.claimRequest.upsert({ where: { dropId: drop.id }, create: { dropId: drop.id, userId: user.id }, update: {} });
      if (reservation.userId !== user.id) throw new AppError(409, "This drop is already being claimed by another receiver.");
    });
    return withLock(`user:${user.id}`, async () => {
      const current = await db.drop.findUniqueOrThrow({ where: { id: drop.id } });
      if (current.status !== "CREATED") return { drop: current, user, alreadyClaimed: true, ...(await accountBalance(user.custodialPubKey!)) };
      const key = userKey(user);
      await friendbot(key.publicKey());
      await ensureTrustline(key);
      await withLock(`account:${escrowKey().publicKey()}`, async () => {
        await settleSource(escrowKey().publicKey());
        let job = await db.ledgerJob.findUnique({ where: { kind_reference: { kind: "CLAIM", reference: drop.id } } });
        if (!job || job.state === "FAILED") {
          if (!current.stellarBalanceId) throw new AppError(409, "The sender's transaction is still being confirmed.");
          // The escrow is the sole claimant. Claiming releases funds to escrow;
          // the second operation transfers exactly those funds to the receiver.
          const tx = await buildTransaction(escrowKey().publicKey(), [
            Operation.claimClaimableBalance({ balanceId: current.stellarBalanceId }),
            Operation.payment({ destination: key.publicKey(), asset: usdc, amount: current.amount }),
          ], Memo.text(`Claim ${current.claimCode}`));
          tx.sign(escrowKey());
          job = await persistJob("CLAIM", drop.id, tx);
        }
        await runJob(job.id);
      });
      return { drop: await db.drop.findUniqueOrThrow({ where: { id: drop.id } }), user, alreadyClaimed: false, ...(await accountBalance(key.publicKey())) };
    });
  });
}
export async function dashboard(session: Session) {
  const drops = await db.drop.findMany({ where: { senderId: session.userId }, orderBy: { createdAt: "desc" }, take: 500 });
  const all = await db.drop.findMany({ where: { senderId: session.userId }, select: { amount: true, status: true } });
  const logs = await db.transactionLog.findMany({ where: { dropId: { in: drops.map(d => d.id) } }, select: { dropId: true, txHash: true, type: true, status: true } });
  const claimed = all.filter(d => ["CLAIMED", "WITHDRAWN"].includes(d.status)).length;
  return {
    drops: drops.map(drop => ({ ...drop, transactions: logs.filter(log => log.dropId === drop.id) })),
    stats: { totalSent: amountFromUnits(all.reduce((sum, drop) => sum + units(drop.amount), 0n)), activeDrops: all.filter(d => d.status === "CREATED").length, claimRate: all.length ? Math.round(claimed / all.length * 100) : 0, totalDrops: all.length },
    wallet: { publicKey: session.publicKey, ...(await accountBalance(session.publicKey)) },
  };
}
