import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Asset, Keypair, Operation } from "@stellar/stellar-sdk";
import { TESTNET, units } from "@stellardrop/shared";
import { db, lockPool } from "../src/db.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { accountBalance, buildTransaction, escrowKey, friendbot, horizon, initializeEscrow, usdc } from "../src/stellar.js";
import { claimDrop, createDrop, ensureTrustline, prepareDrop } from "../src/drops.js";
import { beginWithdrawal, discoverAnchor, anchorInfo, pollWithdrawal } from "../src/anchor.js";
import { completeAuth, createAuthChallenge } from "../src/auth.js";

// Opt-in integration script. All ledger calls use the live, fixed Testnet.
// It spends only Friendbot XLM and USDC obtained through a real Testnet path.
const report: Record<string, unknown> = { network: "TESTNET", startedAt: new Date().toISOString() };
try {
  console.log("Checking live Testnet escrow and trustline…");
  await initializeEscrow(); await ensureTrustline(escrowKey());
  let stored = await db.systemKey.findUnique({ where: { name: "live-smoke-sender" } });
  if (!stored) {
    const key = Keypair.random();
    stored = await db.systemKey.create({ data: { name: "live-smoke-sender", publicKey: key.publicKey(), encrypted: encrypt(key.secret(), "live-smoke-sender") } });
  }
  const sender = Keypair.fromSecret(decrypt(stored.encrypted, "live-smoke-sender"));
  console.log("Funding the smoke-test sender and establishing its live USDC trustline…");
  await friendbot(sender.publicKey()); await ensureTrustline(sender);
  const amount = "2";
  if (units((await accountBalance(sender.publicKey())).balance) < units(amount)) {
    const paths = await horizon.strictReceivePaths([Asset.native()], usdc, amount).call();
    const path = paths.records.find(path => path.source_asset_type === "native" && Number(path.source_amount) < 1000);
    if (!path) throw new Error(`No Testnet XLM → USDC liquidity. Fund ${sender.publicKey()} with 2 Testnet USDC at faucet.circle.com, then retry.`);
    const assets = path.path.map(asset => asset.asset_type === "native" ? Asset.native() : new Asset(asset.asset_code!, asset.asset_issuer!));
    const tx = await buildTransaction(sender.publicKey(), [Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: String(Math.ceil(Number(path.source_amount) * 1.1)), destination: sender.publicKey(), destAsset: usdc, destAmount: amount, path: assets })]);
    tx.sign(sender); const response = await horizon.submitTransaction(tx); report.usdcFundingHash = response.hash;
  }
  const challenge = await createAuthChallenge(sender.publicKey());
  console.log("Verifying wallet ownership and creating an atomic funded drop…");
  const { parseTransaction } = await import("../src/stellar.js");
  const authentication = parseTransaction(challenge.transaction); authentication.sign(sender);
  await completeAuth(challenge.challengeId, authentication.toXDR()); report.walletAuthentication = "verified";
  const user = await db.user.findUniqueOrThrow({ where: { walletPublicKey: sender.publicKey() } });
  const session = { userId: user.id, publicKey: sender.publicKey() };
  const prepared = await prepareDrop(session, amount);
  const funding = parseTransaction(prepared.transaction); funding.sign(sender);
  const body = { amount, senderPublicKey: sender.publicKey(), intentId: prepared.intentId, signedTransaction: funding.toXDR() };
  const drop = await createDrop(session, body);
  const duplicate = await createDrop(session, body);
  if (duplicate.id !== drop.id) throw new Error("Duplicate funding created a second drop");
  report.createHash = Buffer.from(funding.hash()).toString("hex"); report.claimableBalanceId = drop.stellarBalanceId;
  console.log("Funding confirmed. Racing two receivers, then retrying the winning claim…");
  const suffix = randomUUID();
  const ids = [`live-test:${suffix}:a`, `live-test:${suffix}:b`];
  const claims = await Promise.allSettled(ids.map(id => claimDrop(drop.claimCode, id)));
  const successful = claims.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof claimDrop>>> => r.status === "fulfilled");
  if (successful.length !== 1 || claims.filter(r => r.status === "rejected").length !== 1) throw new Error("Concurrent claim did not produce exactly one receiver");
  const receiver = successful[0]!.value;
  const repeated = await claimDrop(drop.claimCode, receiver.user.telegramId!);
  if (!repeated.alreadyClaimed || units(repeated.balance) !== units(amount)) throw new Error("Claim retry changed the balance");
  report.claimHash = (await db.transactionLog.findFirstOrThrow({ where: { dropId: drop.id, type: "CLAIM" } })).txHash;
  report.sender = sender.publicKey(); report.receiver = receiver.user.custodialPubKey;
  report.dropId = drop.id; report.receiverTelegramId = receiver.user.telegramId;
  report.receiverBalance = repeated.balance; report.concurrentClaim = "one receiver; duplicate claim idempotent";
  report.anchor = await discoverAnchor(); report.withdrawalLimits = await anchorInfo();
  console.log("Claim confirmed. Authenticating directly with SEP-10 and starting SEP-24…");
  const withdrawal = await beginWithdrawal(receiver.user.telegramId!, amount);
  await pollWithdrawal(withdrawal.id);
  const status = await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
  report.withdrawalId = withdrawal.id; report.anchorTransactionId = withdrawal.anchorId;
  report.anchorStatus = status.status; report.sep10 = "verified challenge and exchanged signed transaction for a token";
  report.sep24 = "live interactive withdrawal initialized; bank interaction required before payment";
  report.completedAt = new Date().toISOString();
  const directory = fileURLToPath(new URL("../../../.data/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/live-testnet-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await db.$disconnect(); await lockPool.end(); }
