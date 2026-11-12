import { Keypair, Memo, Operation, StellarToml, StrKey, WebAuth } from "@stellar/stellar-sdk";
import { z } from "zod";
import { TESTNET, amountFromUnits, units } from "@stellardrop/shared";
import { db, withLock } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { AppError, logger } from "./errors.js";
import { accountBalance, buildTransaction, userKey, usdc } from "./stellar.js";
import { persistJob, runJob, settleSource } from "./ledger.js";
import { fetchExternal, retryRead } from "./http.js";

type AnchorConfig = { auth: string; transfer: string; signingKey: string };
let cached: { config: AnchorConfig; until: number } | undefined;
export function trustedAnchorUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== TESTNET.anchor || url.port || url.username || url.password) throw new AppError(502, "Anchor returned an untrusted URL.");
  return url;
}
export function trustedInteractiveUrl(value: string) {
  const url = new URL(value);
  if (![ `https://${TESTNET.anchor}`, TESTNET.anchorInteractiveOrigin ].includes(url.origin) || url.username || url.password) throw new AppError(502, "Anchor returned an untrusted interactive URL.");
  return url;
}
export async function discoverAnchor(): Promise<AnchorConfig> {
  if (cached && cached.until > Date.now()) return cached.config;
  const toml = await retryRead(() => StellarToml.Resolver.resolve(TESTNET.anchor, { timeout: 20000 }));
  if (toml.NETWORK_PASSPHRASE !== TESTNET.passphrase || !toml.SIGNING_KEY || !StrKey.isValidEd25519PublicKey(toml.SIGNING_KEY)) throw new AppError(502, "Anchor Testnet configuration could not be verified.");
  const auth = trustedAnchorUrl(String(toml.WEB_AUTH_ENDPOINT)).toString();
  const transfer = trustedAnchorUrl(String(toml.TRANSFER_SERVER_SEP0024)).toString().replace(/\/$/, "");
  cached = { config: { auth, transfer, signingKey: toml.SIGNING_KEY }, until: Date.now() + 300000 };
  return cached.config;
}
async function anchorRequest(url: string, init: RequestInit = {}) {
  const response = await fetchExternal(trustedAnchorUrl(url), init);
  if (!response.ok) throw new AppError(502, `The SDF Test Anchor returned HTTP ${response.status}. Please try again.`, response.status === 401 ? "ANCHOR_UNAUTHORIZED" : "ANCHOR_ERROR");
  return response.json() as Promise<unknown>;
}
export async function authenticateAnchor(key: Keypair) {
  const config = await discoverAnchor();
  const url = new URL(config.auth);
  url.searchParams.set("account", key.publicKey());
  url.searchParams.set("home_domain", TESTNET.anchor);
  const response = z.object({ transaction: z.string(), network_passphrase: z.literal(TESTNET.passphrase).optional() }).parse(await anchorRequest(url.toString()));
  // SDK verifies sequence zero, time bounds, server signature, operation types,
  // home domain, and web_auth_domain before the custodial key signs anything.
  const challenge = WebAuth.readChallengeTx(response.transaction, config.signingKey, TESTNET.passphrase, TESTNET.anchor, new URL(config.auth).hostname);
  if (challenge.clientAccountID !== key.publicKey()) throw new AppError(502, "Anchor challenge belongs to another account.");
  challenge.tx.sign(key);
  return z.object({ token: z.string().min(1) }).parse(await anchorRequest(config.auth, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ transaction: challenge.tx.toXDR() }) })).token;
}
const infoSchema = z.object({ withdraw: z.record(z.string(), z.object({ enabled: z.boolean(), min_amount: z.number().optional(), max_amount: z.number().optional() })) });
export async function anchorInfo() {
  const config = await discoverAnchor();
  const info = infoSchema.parse(await anchorRequest(`${config.transfer}/info`));
  const asset = info.withdraw.USDC;
  if (!asset?.enabled) throw new AppError(503, "USDC withdrawals are currently unavailable at the SDF Test Anchor.");
  return { min: String(asset.min_amount ?? 0), max: asset.max_amount === undefined ? null : String(asset.max_amount) };
}
type Allocation = { dropId: string; amount: string };
export function allocateWithdrawal(drops: { id: string; amount: string; withdrawnAmount: string }[], amount: string): Allocation[] {
  let remaining = units(amount);
  const allocations: Allocation[] = [];
  for (const drop of drops) {
    const available = units(drop.amount) - units(drop.withdrawnAmount);
    const allocated = available < remaining ? available : remaining;
    if (allocated > 0n) allocations.push({ dropId: drop.id, amount: amountFromUnits(allocated) });
    remaining -= allocated > 0n ? allocated : 0n;
    if (remaining === 0n) break;
  }
  if (remaining > 0n) throw new AppError(409, "Your claimed drop balance is not sufficient for this withdrawal.");
  return allocations;
}
export async function beginWithdrawal(telegramId: string, requestedAmount?: string) {
  const user = await db.user.findUnique({ where: { telegramId } });
  if (!user?.custodialPubKey) throw new AppError(400, "Claim a drop first, then type /withdraw.");
  return withLock(`user:${user.id}`, async () => {
    const active = await db.withdrawal.findUnique({ where: { activeUserId: user.id } });
    if (active) {
      if (!active.interactiveUrl) throw new AppError(409, "Your withdrawal is being initialized. Please retry shortly.");
      return active;
    }
    const key = userKey(user);
    const [wallet, limits, drops] = await Promise.all([
      accountBalance(key.publicKey()), anchorInfo(),
      db.drop.findMany({ where: { receiverId: user.id, status: "CLAIMED" }, orderBy: { createdAt: "asc" } }),
    ]);
    const tracked = drops.reduce((sum, drop) => sum + units(drop.amount) - units(drop.withdrawnAmount), 0n);
    let available = units(wallet.balance) < tracked ? units(wallet.balance) : tracked;
    if (limits.max && available > units(limits.max)) available = units(limits.max);
    let amount: string;
    try { amount = requestedAmount ? amountFromUnits(units(requestedAmount)) : amountFromUnits(available); }
    catch { throw new AppError(400, "Use /withdraw followed by a USDC amount, for example /withdraw 5."); }
    if (units(amount) <= 0n || units(amount) > available || units(amount) < units(limits.min)) throw new AppError(400, `Enter an amount between ${limits.min} and ${amountFromUnits(available)} Testnet USDC. The anchor's limit is ${limits.max ?? "unlimited"} per withdrawal.`);
    const allocations = allocateWithdrawal(drops, amount);
    const withdrawal = await db.withdrawal.create({ data: { userId: user.id, activeUserId: user.id, amount, dropIds: allocations.map(a => a.dropId), allocations } });
    try {
      const token = await authenticateAnchor(key);
      const config = await discoverAnchor();
      const form = new FormData();
      for (const [field, value] of Object.entries({ asset_code: "USDC", asset_issuer: TESTNET.issuer, account: key.publicKey(), amount, lang: "en" })) form.set(field, value);
      const response = z.object({ type: z.literal("interactive_customer_info_needed"), url: z.string(), id: z.string().min(1) }).parse(await anchorRequest(`${config.transfer}/transactions/withdraw/interactive`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      }));
      trustedInteractiveUrl(response.url);
      return await db.withdrawal.update({ where: { id: withdrawal.id }, data: { anchorId: response.id, encryptedToken: encrypt(token, `anchor:${withdrawal.id}`), interactiveUrl: response.url, status: "incomplete" } });
    } catch (error) {
      await db.withdrawal.update({ where: { id: withdrawal.id }, data: { status: "INIT_FAILED", activeUserId: null, lastError: "Interactive initialization failed; no funds sent" } });
      throw error;
    }
  });
}

const transactionSchema = z.object({ transaction: z.object({
  id: z.string(), status: z.string(), kind: z.string(),
  amount_in: z.string().optional(), amount_in_asset: z.string().optional(),
  amount_out: z.string().optional(), amount_out_asset: z.string().optional(),
  withdraw_anchor_account: z.string().optional(), withdraw_memo: z.string().optional(), withdraw_memo_type: z.string().optional(),
}) });
export function withdrawalMemo(type: string | undefined, value: string | undefined) {
  if (!type && !value) return undefined;
  if (type === "text" && value && Buffer.byteLength(value) <= 28) return Memo.text(value);
  if (type === "id" && value && /^\d{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n) return Memo.id(value);
  if (type === "hash" && value && Buffer.from(value, "base64").length === 32) return Memo.hash(Buffer.from(value, "base64"));
  throw new AppError(502, "Anchor returned an unsupported or invalid payment memo.");
}
export type Notify = (telegramId: string, text: string) => Promise<unknown>;
export async function pollWithdrawal(id: string) {
  const original = await db.withdrawal.findUniqueOrThrow({ where: { id } });
  return withLock(`user:${original.userId}`, async () => {
    let withdrawal = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { user: true } });
    if (!withdrawal.activeUserId || !withdrawal.anchorId || !withdrawal.encryptedToken) return;
    const key = userKey(withdrawal.user);
    const config = await discoverAnchor();
    let token = decrypt(withdrawal.encryptedToken, `anchor:${id}`);
    const query = `${config.transfer}/transaction?id=${encodeURIComponent(withdrawal.anchorId)}`;
    let response;
    try { response = await anchorRequest(query, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (error) {
      if (!(error instanceof AppError && error.code === "ANCHOR_UNAUTHORIZED")) throw error;
      token = await authenticateAnchor(key);
      await db.withdrawal.update({ where: { id }, data: { encryptedToken: encrypt(token, `anchor:${id}`) } });
      response = await anchorRequest(query, { headers: { Authorization: `Bearer ${token}` } });
    }
    const transaction = transactionSchema.parse(response).transaction;
    if (transaction.id !== withdrawal.anchorId || transaction.kind !== "withdrawal") throw new AppError(502, "Anchor transaction identity mismatch.");
    await db.withdrawal.update({ where: { id }, data: { status: transaction.status, nextPollAt: new Date(Date.now() + 10000), lastError: null } });
    if (transaction.status === "pending_user_transfer_start" && !withdrawal.paymentHash) {
      const destination = transaction.withdraw_anchor_account;
      if (!destination || !(StrKey.isValidEd25519PublicKey(destination) || StrKey.isValidMed25519PublicKey(destination))) throw new AppError(502, "Anchor has not supplied a valid payment account.");
      if (!transaction.amount_in || units(transaction.amount_in) !== units(withdrawal.amount)) throw new AppError(502, "Anchor payment amount differs from the approved withdrawal.");
      if (transaction.amount_in_asset && transaction.amount_in_asset !== `stellar:USDC:${TESTNET.issuer}`) throw new AppError(502, "Anchor requested a different asset.");
      const memo = withdrawalMemo(transaction.withdraw_memo_type, transaction.withdraw_memo);
      await withLock(`account:${key.publicKey()}`, async () => {
        await settleSource(key.publicKey());
        let job = await db.ledgerJob.findUnique({ where: { kind_reference: { kind: "WITHDRAW", reference: id } } });
        if (!job || job.state === "FAILED") {
          const tx = await buildTransaction(key.publicKey(), [Operation.payment({ destination, asset: usdc, amount: withdrawal.amount })], memo);
          tx.sign(key);
          job = await persistJob("WITHDRAW", id, tx);
        }
        await runJob(job.id);
      });
    } else if (transaction.status === "completed") {
      // Reconcile a payment submitted just before a process restart before settling.
      const job = await db.ledgerJob.findUnique({ where: { kind_reference: { kind: "WITHDRAW", reference: id } } });
      if (!job) throw new AppError(502, "Anchor completed an unrecognized payment; manual review required.");
      await withLock(`account:${key.publicKey()}`, () => runJob(job.id));
      withdrawal = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { user: true } });
      const currency = transaction.amount_out_asset?.split(":").pop() ?? "fiat";
      const label = currency === "NGN" ? "Testnet NGN" : `test ${/^[A-Za-z]{3}$/.test(currency) ? currency : "fiat"}`;
      const completionMessage = `✅ Success! Your ${label} has been deposited into your test bank account. This is a simulated payout.`;
      await db.$transaction(async tx => {
        const current = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
        if (!current.activeUserId) return;
        const allocations = z.array(z.object({ dropId: z.string(), amount: z.string() })).parse(current.allocations);
        for (const allocation of allocations) {
          const drop = await tx.drop.findUniqueOrThrow({ where: { id: allocation.dropId } });
          const withdrawn = units(drop.withdrawnAmount) + units(allocation.amount);
          if (withdrawn > units(drop.amount)) throw new Error("Withdrawal allocation exceeds drop amount");
          await tx.drop.update({ where: { id: drop.id }, data: { withdrawnAmount: amountFromUnits(withdrawn), status: withdrawn === units(drop.amount) ? "WITHDRAWN" : "CLAIMED" } });
        }
        await tx.transactionLog.createMany({ data: current.dropIds.map(dropId => ({ dropId, txHash: current.paymentHash!, type: "WITHDRAW_ANCHOR_SETTLE", status: "SUCCESS" })), skipDuplicates: true });
        await tx.withdrawal.update({ where: { id }, data: { status: "completed", activeUserId: null, encryptedToken: null, interactiveUrl: null, lastError: completionMessage } });
      });
    } else if (["error", "expired", "refunded", "no_market", "too_small", "too_large"].includes(transaction.status)) {
      await db.withdrawal.update({ where: { id }, data: { activeUserId: null, encryptedToken: null, interactiveUrl: null, lastError: "The anchor ended this test withdrawal. Check /balance before trying again." } });
    }
  });
}

export async function pollWithdrawals(notify?: Notify) {
  // An interrupted interactive initialization never sends a payment. Release it.
  await db.withdrawal.updateMany({ where: { status: "INITIATING", createdAt: { lt: new Date(Date.now() - 300000) } }, data: { status: "INIT_FAILED", activeUserId: null, lastError: "Initialization interrupted; no payment submitted" } });
  const pending = await db.withdrawal.findMany({ where: { activeUserId: { not: null }, anchorId: { not: null }, nextPollAt: { lte: new Date() } }, take: 30 });
  for (const withdrawal of pending) {
    try { await pollWithdrawal(withdrawal.id); }
    catch (error) {
      logger.warn({ withdrawalId: withdrawal.id, code: error instanceof AppError ? error.code : "ANCHOR_RETRY" }, "Anchor polling will retry");
      await db.withdrawal.update({ where: { id: withdrawal.id }, data: { lastError: "Anchor polling interrupted; retrying safely", nextPollAt: new Date(Date.now() + 30000) } });
    }
  }
  if (notify) {
    const notifications = await db.withdrawal.findMany({ where: { activeUserId: null, notifiedAt: null, status: { in: ["completed", "error", "expired", "refunded", "no_market", "too_small", "too_large"] } }, include: { user: true }, take: 30 });
    for (const withdrawal of notifications) {
      if (!withdrawal.user.telegramId || !/^\d+$/.test(withdrawal.user.telegramId)) continue;
      await withLock(`notify:${withdrawal.id}`, async () => {
        const current = await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
        if (current.notifiedAt) return;
        try {
          await notify(withdrawal.user.telegramId!, current.lastError ?? "Your test withdrawal has been updated. Type /balance to check your wallet.");
          await db.withdrawal.update({ where: { id: current.id }, data: { notifiedAt: new Date() } });
        } catch { logger.warn({ withdrawalId: current.id }, "Telegram completion notification will retry"); }
      });
    }
  }
}
