import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";
import { db, lockPool } from "../src/db.js";
import { env } from "../src/config.js";
import { decrypt } from "../src/crypto.js";
import { AppError } from "../src/errors.js";
import { issueSession } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { createDrop } from "../src/drops.js";
import { emailWalletKey } from "../src/stellar.js";
import { netlifyRequest } from "./netlify-client.js";

vi.mock("../src/email.js", () => ({ sendVerificationEmail: vi.fn() }));
const { sendVerificationEmail } = await import("../src/email.js");
const { normalizeEmail, requestEmailCode, verifyEmailCode } = await import("../src/email-auth.js");
const sendEmail = vi.mocked(sendVerificationEmail);
const emails = new Set<string>();
const intentIds: string[] = [];
const app = createApp();
const nextEmail = () => { const email = `email-test-${randomUUID()}@example.invalid`; emails.add(email); return email; };
async function requestCode(email = nextEmail()) {
  const challenge = await requestEmailCode(email);
  const call = sendEmail.mock.calls.filter(call => call[0] === email).at(-1);
  expect(call).toBeDefined();
  return { ...challenge, code: call![1] };
}
beforeEach(() => { sendEmail.mockReset(); sendEmail.mockResolvedValue(undefined); });
afterAll(async () => {
  await db.fundingIntent.deleteMany({ where: { id: { in: intentIds } } });
  await db.emailChallenge.deleteMany({ where: { email: { in: [...emails] } } });
  await db.user.deleteMany({ where: { email: { in: [...emails] } } });
  await db.$disconnect(); await lockPool.end();
});

describe("email verification and generated wallet ownership", () => {
  it("creates an encrypted wallet through the Netlify request and verification endpoints", async () => {
    const email = nextEmail();
    const challenge = await netlifyRequest("/api/auth/email/request", "POST", { email });
    expect(challenge.status).toBe(202);
    const code = sendEmail.mock.calls.find(call => call[0] === email)![1];
    const verified = await netlifyRequest("/.netlify/functions/api/api/auth/email/verify", "POST", { challengeId: challenge.body.challengeId, code });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ authMethod: "email", email });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(Keypair.fromSecret(decrypt(user.custodialEncSecKey!, `user:${user.id}`)).publicKey()).toBe(verified.body.publicKey);
    expect(verified.body).not.toHaveProperty("custodialEncSecKey");
    const me = await netlifyRequest("/api/me", "GET", undefined, { authorization: `Bearer ${verified.body.token}` });
    expect(me.status).toBe(200); expect(me.body.publicKey).toBe(verified.body.publicKey);
  });
  it("normalizes addresses without removing email tags", () => {
    expect(normalizeEmail("  Person+Tag@Example.com ")).toBe("person+tag@example.com");
    expect(() => normalizeEmail("person@example.com\r\nBcc: attacker@example.com")).toThrow();
  });
  it("sends a code without creating a user or exposing the code in the response", async () => {
    const email = nextEmail();
    const response = await request(app).post("/api/auth/email/request").send({ email });
    expect(response.status).toBe(202);
    expect(response.body).not.toHaveProperty("code");
    expect(response.body).not.toHaveProperty("token");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    const challenge = await db.emailChallenge.findUniqueOrThrow({ where: { id: response.body.challengeId } });
    expect(challenge.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.codeHash).not.toBe(sendEmail.mock.calls.at(-1)![1]);
  });
  it("persists failed attempts and locks the code after five incorrect guesses", async () => {
    const challenge = await requestCode();
    const wrong = challenge.code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) await expect(verifyEmailCode(challenge.challengeId, wrong)).rejects.toMatchObject({ status: 401 });
    const record = await db.emailChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } });
    expect(record.attempts).toBe(5); expect(record.usedAt).not.toBeNull();
    await expect(verifyEmailCode(challenge.challengeId, challenge.code)).rejects.toMatchObject({ status: 401 });
    expect(await db.user.findUnique({ where: { email: challenge.email } })).toBeNull();
  });
  it("rejects expired codes without generating wallet keys", async () => {
    const challenge = await requestCode();
    await db.emailChallenge.update({ where: { id: challenge.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyEmailCode(challenge.challengeId, challenge.code)).rejects.toMatchObject({ status: 401 });
    expect(await db.user.findUnique({ where: { email: challenge.email } })).toBeNull();
  });
  it("generates one encrypted wallet and accepts a valid code once under concurrency", async () => {
    const challenge = await requestCode();
    const results = await Promise.allSettled([verifyEmailCode(challenge.challengeId, challenge.code), verifyEmailCode(challenge.challengeId, challenge.code)]);
    const accepted = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof verifyEmailCode>>> => result.status === "fulfilled");
    expect(accepted).toHaveLength(1); expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const session = accepted[0]!.value;
    const user = await db.user.findUniqueOrThrow({ where: { email: challenge.email } });
    expect(user.emailVerifiedAt).not.toBeNull(); expect(user.walletPublicKey).toBeNull();
    const key = Keypair.fromSecret(decrypt(user.custodialEncSecKey!, `user:${user.id}`));
    expect(key.publicKey()).toBe(session.publicKey);
    expect(user.custodialEncSecKey).not.toContain(key.secret());
    expect(jwt.verify(session.token, env.JWT_SECRET)).toMatchObject({ sub: user.id, wallet: key.publicKey(), authMethod: "email" });
    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${session.token}`);
    expect(me.status).toBe(200); expect(me.body).toEqual({ publicKey: key.publicKey(), authMethod: "email", email: challenge.email });
    expect(me.body).not.toHaveProperty("custodialEncSecKey");
  });
  it("logs an existing email account into the same wallet without regenerating its key", async () => {
    const first = await requestCode();
    const original = await verifyEmailCode(first.challengeId, first.code);
    const user = await db.user.findUniqueOrThrow({ where: { email: first.email } });
    await db.emailChallenge.update({ where: { id: first.challengeId }, data: { createdAt: new Date(Date.now() - 61000) } });
    const second = await requestCode(first.email);
    const returning = await verifyEmailCode(second.challengeId, second.code);
    expect(returning.publicKey).toBe(original.publicKey);
    expect((await db.user.findUniqueOrThrow({ where: { email: first.email } })).custodialEncSecKey).toBe(user.custodialEncSecKey);
  });
  it("invalidates the previous code when a new one is sent", async () => {
    const first = await requestCode();
    await db.emailChallenge.update({ where: { id: first.challengeId }, data: { createdAt: new Date(Date.now() - 61000) } });
    const second = await requestCode(first.email);
    await expect(verifyEmailCode(first.challengeId, first.code)).rejects.toMatchObject({ status: 401 });
    expect((await verifyEmailCode(second.challengeId, second.code)).authMethod).toBe("email");
  });
  it("enforces a shared per-email cooldown under concurrent requests", async () => {
    const email = nextEmail();
    const results = await Promise.allSettled([requestEmailCode(email), requestEmailCode(email)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 429, code: "EMAIL_COOLDOWN" } });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it("limits total verification emails per address per hour", async () => {
    const email = nextEmail();
    await db.emailChallenge.createMany({ data: Array.from({ length: 5 }, () => ({ email, codeHash: "a".repeat(64), status: "SENT", expiresAt: new Date(Date.now() + 600000), createdAt: new Date(Date.now() - 120000) })) });
    await expect(requestEmailCode(email)).rejects.toMatchObject({ status: 429, code: "EMAIL_RATE_LIMIT" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("does not accept a code whose email delivery failed", async () => {
    const email = nextEmail();
    sendEmail.mockRejectedValueOnce(new AppError(503, "Could not deliver email", "EMAIL_DELIVERY_FAILED"));
    await expect(requestEmailCode(email)).rejects.toMatchObject({ status: 503 });
    const record = await db.emailChallenge.findFirstOrThrow({ where: { email } });
    expect(record.status).toBe("FAILED"); expect(record.usedAt).not.toBeNull();
    await expect(verifyEmailCode(record.id, sendEmail.mock.calls.at(-1)![1])).rejects.toMatchObject({ status: 401 });
  });
  it("does not let an external wallet session act as an email wallet", async () => {
    const challenge = await requestCode();
    const emailSession = await verifyEmailCode(challenge.challengeId, challenge.code);
    const user = await db.user.findUniqueOrThrow({ where: { email: challenge.email } });
    const external = issueSession(user.id, emailSession.publicKey, "wallet");
    const response = await request(app).post("/api/wallet/activate").set("Authorization", `Bearer ${external.token}`).send({});
    expect(response.status).toBe(403);
  });
  it("rejects custody access for an unverified or mismatched account", async () => {
    const challenge = await requestCode();
    const session = await verifyEmailCode(challenge.challengeId, challenge.code);
    const user = await db.user.findUniqueOrThrow({ where: { email: challenge.email } });
    await expect(emailWalletKey({ userId: user.id, publicKey: Keypair.random().publicKey(), authMethod: "email" })).rejects.toMatchObject({ status: 403 });
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await expect(emailWalletKey({ userId: user.id, publicKey: session.publicKey, authMethod: "email" })).rejects.toMatchObject({ status: 403 });
  });
  it("refuses to sign arbitrary envelopes or another sender's funding intent", async () => {
    const challenge = await requestCode();
    const session = await verifyEmailCode(challenge.challengeId, challenge.code);
    const user = await db.user.findUniqueOrThrow({ where: { email: challenge.email } });
    const intent = await db.fundingIntent.create({ data: { senderId: user.id, publicKey: session.publicKey, claimCode: `TEST${randomUUID().replaceAll("-", "").slice(0, 12)}`, amount: "2", unsignedXdr: "unused-test-envelope", txHash: randomUUID(), expiresAt: new Date(Date.now() + 300000) } });
    intentIds.push(intent.id);
    const identity = { userId: user.id, publicKey: session.publicKey, authMethod: "email" as const };
    await expect(createDrop(identity, { amount: "2", senderPublicKey: session.publicKey, intentId: intent.id, signedTransaction: "arbitrary-envelope" })).rejects.toMatchObject({ status: 400 });
    await expect(createDrop({ ...identity, userId: randomUUID() }, { amount: "2", senderPublicKey: session.publicKey, intentId: intent.id })).rejects.toMatchObject({ status: 403 });
    expect(await db.ledgerJob.count({ where: { reference: intent.id } })).toBe(0);
  });
});
