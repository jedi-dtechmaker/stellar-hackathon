import { Account, Keypair, Operation, TransactionBuilder, StrKey } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { TESTNET } from "@stellardrop/shared";
import { db } from "./db.js";
import { env } from "./config.js";
import { AppError, isNotFound } from "./errors.js";
import { escrowKey, horizon, parseTransaction } from "./stellar.js";
import type { Request } from "express";
import type { AuthMethod } from "@stellardrop/shared";

export async function createAuthChallenge(publicKey: string) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) throw new AppError(400, "Invalid Stellar public key.");
  const tx = new TransactionBuilder(new Account(escrowKey().publicKey(), "-1"), { fee: "100", networkPassphrase: TESTNET.passphrase })
    .addOperation(Operation.manageData({ name: `${new URL(env.WEB_ORIGIN).hostname} auth`, value: randomBytes(32).toString("base64"), source: publicKey }))
    .setTimeout(300).build();
  tx.sign(escrowKey());
  const challenge = await db.authChallenge.create({ data: { publicKey, message: tx.toXDR(), expiresAt: new Date(Date.now() + 300000) } });
  return { challengeId: challenge.id, transaction: tx.toXDR(), networkPassphrase: TESTNET.passphrase };
}

export async function verifyWalletSignatures(publicKey: string, transaction: ReturnType<typeof parseTransaction>) {
  let threshold = 1;
  let signers = [{ key: publicKey, weight: 1 }];
  try {
    const account = await horizon.loadAccount(publicKey);
    threshold = Math.max(1, account.thresholds.med_threshold);
    signers = account.signers.filter(s => s.type === "ed25519_public_key").map(s => ({ key: s.key, weight: s.weight }));
  } catch (error) { if (!isNotFound(error)) throw error; }
  const hash = transaction.hash();
  const weight = signers.reduce((sum, signer) => {
    const key = Keypair.fromPublicKey(signer.key);
    return sum + (transaction.signatures.some(signature => {
      try { return key.verify(hash, signature.signature); } catch { return false; }
    }) ? signer.weight : 0);
  }, 0);
  if (weight < threshold) throw new AppError(401, "The wallet signature is missing or does not meet the account's signing threshold.");
}

export async function completeAuth(challengeId: string, signedTransaction: string) {
  const challenge = await db.authChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() < Date.now()) throw new AppError(401, "Wallet challenge expired or already used. Connect again.");
  const transaction = parseTransaction(signedTransaction);
  if (!Buffer.from(transaction.hash()).equals(Buffer.from(parseTransaction(challenge.message).hash()))) throw new AppError(401, "Wallet challenge was modified.");
  await verifyWalletSignatures(challenge.publicKey, transaction);
  const user = await db.$transaction(async tx => {
    const used = await tx.authChallenge.updateMany({ where: { id: challengeId, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!used.count) throw new AppError(401, "Wallet challenge already used.");
    return tx.user.upsert({ where: { walletPublicKey: challenge.publicKey }, create: { walletPublicKey: challenge.publicKey }, update: {} });
  });
  return issueSession(user.id, challenge.publicKey, "wallet");
}

export function issueSession(userId: string, publicKey: string, authMethod: AuthMethod, email: string | null = null) {
  return {
    token: jwt.sign({ wallet: publicKey, authMethod }, env.JWT_SECRET, { subject: userId, issuer: "stellardrop", audience: "stellardrop-web", algorithm: "HS256", expiresIn: "8h" }),
    publicKey, authMethod, email,
  };
}

export interface Session { userId: string; publicKey: string; authMethod?: AuthMethod }
export function sessionOf(req: Request): Session {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError(401, "Sign in to continue.");
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "stellardrop", audience: "stellardrop-web", algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub || typeof payload.wallet !== "string") throw new Error("Invalid session");
    const authMethod = payload.authMethod ?? "wallet";
    if (authMethod !== "wallet" && authMethod !== "email") throw new Error("Invalid authentication method");
    return { userId: payload.sub, publicKey: payload.wallet, authMethod };
  } catch { throw new AppError(401, "Your session expired. Sign in again."); }
}
