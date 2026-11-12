import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";
import { db, withLock } from "./db.js";
import { env } from "./config.js";
import { encrypt, secretMatches } from "./crypto.js";
import { AppError } from "./errors.js";
import { sendVerificationEmail } from "./email.js";
import { issueSession } from "./auth.js";

const emailSchema = z.email().max(254);
const lifetime = 10 * 60000;
const cooldown = 60000;
export function normalizeEmail(value: string) {
  return emailSchema.parse(value.trim().toLowerCase());
}
function emailLock(email: string) { return `email:${createHash("sha256").update(email).digest("hex")}`; }
function codeHash(id: string, email: string, code: string) {
  return createHmac("sha256", env.JWT_SECRET).update(`stellardrop:email-code\0${id}\0${email}\0${code}`).digest("hex");
}
const invalidCode = () => new AppError(401, "That code is invalid or expired. Try again or request a new code.", "EMAIL_CODE_INVALID");

export async function requestEmailCode(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  return withLock(emailLock(email), async () => {
    const latest = await db.emailChallenge.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
    if (latest && Date.now() - latest.createdAt.getTime() < cooldown) throw new AppError(429, "Please wait a minute before requesting another code.", "EMAIL_COOLDOWN");
    const recent = await db.emailChallenge.count({ where: { email, createdAt: { gt: new Date(Date.now() - 3600000) } } });
    if (recent >= 5) throw new AppError(429, "Too many codes requested. Please try again in an hour.", "EMAIL_RATE_LIMIT");
    const id = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, "0");
    const now = new Date();
    const challenge = await db.$transaction(async tx => {
      await tx.emailChallenge.updateMany({ where: { email, usedAt: null }, data: { usedAt: now } });
      return tx.emailChallenge.create({ data: { id, email, codeHash: codeHash(id, email, code), expiresAt: new Date(now.getTime() + lifetime) } });
    });
    try {
      await sendVerificationEmail(email, code);
      await db.emailChallenge.update({ where: { id }, data: { status: "SENT" } });
    } catch (error) {
      await db.emailChallenge.update({ where: { id }, data: { status: "FAILED", usedAt: new Date() } });
      throw error;
    }
    // Same response for new and existing email accounts. Codes and session
    // tokens never leave the mail channel before proof of inbox ownership.
    return { challengeId: id, email, expiresAt: challenge.expiresAt, resendAt: new Date(challenge.createdAt.getTime() + cooldown) };
  });
}

export async function verifyEmailCode(challengeId: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw invalidCode();
  const lookup = await db.emailChallenge.findUnique({ where: { id: challengeId }, select: { email: true } });
  if (!lookup) throw invalidCode();
  return withLock(emailLock(lookup.email), async () => {
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "EmailChallenge" WHERE id = ${challengeId} FOR UPDATE`;
      const challenge = await tx.emailChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge || challenge.status !== "SENT" || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= 5) return null;
      if (!secretMatches(challenge.codeHash, codeHash(challenge.id, challenge.email, code))) {
        const attempts = challenge.attempts + 1;
        await tx.emailChallenge.update({ where: { id: challengeId }, data: { attempts, ...(attempts >= 5 ? { usedAt: new Date() } : {}) } });
        return null; // Commit attempt counters before returning an auth error.
      }
      const now = new Date();
      await tx.emailChallenge.update({ where: { id: challengeId }, data: { usedAt: now } });
      let user = await tx.user.upsert({ where: { email: challenge.email }, create: { email: challenge.email, emailVerifiedAt: now }, update: { emailVerifiedAt: now } });
      if (!user.custodialEncSecKey) {
        const key = Keypair.random();
        user = await tx.user.update({ where: { id: user.id }, data: { custodialPubKey: key.publicKey(), custodialEncSecKey: encrypt(key.secret(), `user:${user.id}`) } });
      }
      if (!user.custodialPubKey) throw new Error("Email wallet integrity check failed");
      return user;
    });
    if (!result) throw invalidCode();
    return issueSession(result.id, result.custodialPubKey!, "email", result.email);
  });
}
