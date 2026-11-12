import { type LedgerJob, Prisma } from "@prisma/client";
import { type Transaction } from "@stellar/stellar-sdk";
import { db, withLock } from "./db.js";
import { AppError, isNotFound, logger } from "./errors.js";
import { horizon, parseTransaction } from "./stellar.js";
import { TESTNET } from "@stellardrop/shared";

export async function persistJob(kind: string, reference: string, tx: Transaction) {
  const existing = await db.ledgerJob.findUnique({ where: { kind_reference: { kind, reference } } });
  if (existing && existing.state !== "FAILED") return existing;
  const data = { sourcePublicKey: tx.source, signedXdr: tx.toXDR(), txHash: Buffer.from(tx.hash()).toString("hex"), state: "PREPARED", lastError: null };
  return db.ledgerJob.upsert({ where: { kind_reference: { kind, reference } }, create: { kind, reference, ...data }, update: data });
}

async function finalize(job: LedgerJob) {
  let balanceId: string | undefined;
  if (job.kind === "CREATE") {
    const page = await horizon.effects().forTransaction(job.txHash).limit(200).call();
    const effect = page.records.find(effect => effect.type === "claimable_balance_created");
    if (effect && "balance_id" in effect) balanceId = effect.balance_id as string;
    if (!balanceId) throw new AppError(503, "Waiting for Horizon to index the claimable balance.", "LEDGER_PENDING");
  }
  await db.$transaction(async tx => {
    if ((await tx.ledgerJob.findUniqueOrThrow({ where: { id: job.id } })).state === "CONFIRMED") return;
    if (job.kind === "CREATE") {
      const intent = await tx.fundingIntent.findUniqueOrThrow({ where: { id: job.reference } });
      await tx.drop.upsert({ where: { id: intent.id }, update: {}, create: {
        id: intent.id, claimCode: intent.claimCode, amount: intent.amount, assetIssuer: TESTNET.issuer,
        senderId: intent.senderId, stellarBalanceId: balanceId,
      } });
      await tx.transactionLog.createMany({ data: [{ dropId: intent.id, txHash: job.txHash, type: "CREATE", status: "SUCCESS" }], skipDuplicates: true });
    } else if (job.kind === "CLAIM") {
      const reservation = await tx.claimRequest.findUniqueOrThrow({ where: { dropId: job.reference } });
      const changed = await tx.drop.updateMany({ where: { id: job.reference, status: "CREATED" }, data: { status: "CLAIMED", receiverId: reservation.userId } });
      const drop = await tx.drop.findUniqueOrThrow({ where: { id: job.reference } });
      if (!changed.count && drop.receiverId !== reservation.userId) throw new Error("Claim reservation integrity failure");
      await tx.transactionLog.createMany({ data: [{ dropId: job.reference, txHash: job.txHash, type: "CLAIM", status: "SUCCESS" }], skipDuplicates: true });
    } else if (job.kind === "WITHDRAW") {
      const withdrawal = await tx.withdrawal.update({ where: { id: job.reference }, data: { paymentHash: job.txHash } });
      await tx.transactionLog.createMany({ data: withdrawal.dropIds.map(dropId => ({ dropId, txHash: job.txHash, type: "WITHDRAW_ANCHOR_INIT", status: "SUCCESS" })), skipDuplicates: true });
    }
    await tx.ledgerJob.update({ where: { id: job.id }, data: { state: "CONFIRMED", lastError: null } });
  });
}

export async function runJob(jobId: string): Promise<LedgerJob> {
  return withLock(`ledger:${jobId}`, async () => {
    let job = await db.ledgerJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.state === "CONFIRMED") return job;
    if (job.state === "FAILED") throw new AppError(409, "The Testnet transaction failed. Please retry with a new transaction.", "LEDGER_FAILED");
    const tx = parseTransaction(job.signedXdr);
    try {
      const known = await horizon.transactions().transaction(job.txHash).call();
      if (!known.successful) {
        await db.ledgerJob.update({ where: { id: job.id }, data: { state: "FAILED", lastError: "Transaction included but unsuccessful" } });
        throw new AppError(409, "The Testnet transaction failed on the ledger.", "LEDGER_FAILED");
      }
      await finalize(job);
      return db.ledgerJob.findUniqueOrThrow({ where: { id: job.id } });
    } catch (error) { if (!isNotFound(error)) throw error; }

    // Only expire when Horizon has ingested a ledger beyond the envelope's bound.
    const latest = await horizon.ledgers().order("desc").limit(1).call();
    if (tx.timeBounds && Number(tx.timeBounds.maxTime) > 0 && Number(tx.timeBounds.maxTime) * 1000 + 30000 < Date.parse(latest.records[0]!.closed_at)) {
      await db.ledgerJob.update({ where: { id: job.id }, data: { state: "FAILED", lastError: "Expired before ledger inclusion" } });
      throw new AppError(409, "The signing window expired. Please try again.", "LEDGER_FAILED");
    }
    job = await db.ledgerJob.update({ where: { id: job.id }, data: { state: "SUBMITTED" } });
    try {
      await horizon.submitTransaction(tx);
    } catch (error) {
      const data = (error as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } }).response?.data;
      const code = data?.extras?.result_codes?.transaction;
      if (code && !["tx_bad_seq", "tx_too_late", "tx_internal_error"].includes(code)) {
        await db.ledgerJob.update({ where: { id: job.id }, data: { state: "FAILED", lastError: [code, ...(data?.extras?.result_codes?.operations ?? [])].join(",") } });
        throw new AppError(409, `Testnet rejected the transaction (${code}). Check your USDC balance, trustline, and XLM reserve.`, "LEDGER_FAILED");
      }
      await db.ledgerJob.update({ where: { id: job.id }, data: { lastError: code ?? "Submission response unknown; reconciling by hash" } });
      throw new AppError(503, "Testnet confirmation is pending. Retrying this request is safe.", "LEDGER_PENDING");
    }
    await finalize(job);
    return db.ledgerJob.findUniqueOrThrow({ where: { id: job.id } });
  });
}

export async function settleSource(publicKey: string) {
  const pending = await db.ledgerJob.findMany({ where: { sourcePublicKey: publicKey, state: { in: ["PREPARED", "SUBMITTED"] } }, orderBy: { createdAt: "asc" } });
  for (const job of pending) {
    try { await runJob(job.id); }
    catch (error) { if (!(error instanceof AppError && error.code === "LEDGER_FAILED")) throw error; }
  }
}

export async function reconcileLedgerJobs() {
  const jobs = await db.ledgerJob.findMany({ where: { state: { in: ["PREPARED", "SUBMITTED"] } }, take: 30, orderBy: { createdAt: "asc" } });
  for (const job of jobs) {
    try { await withLock(`account:${job.sourcePublicKey}`, () => runJob(job.id)); }
    catch (error) { logger.warn({ jobId: job.id, code: error instanceof AppError ? error.code : "RECONCILE_RETRY" }, "Ledger reconciliation will retry"); }
  }
}
