import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@stellardrop/shared";
import { db, lockPool, withLock, tryWithLock } from "../src/db.js";
import { AppError } from "../src/errors.js";

const serverKey = Keypair.random();
vi.mock("../src/stellar.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/stellar.js")>();
  return { ...original, escrowKey: () => serverKey, friendbot: vi.fn(async () => { throw new AppError(503, "Friendbot interrupted for concurrency test"); }), horizon: { ...original.horizon, loadAccount: vi.fn(async () => { throw { response: { status: 404 } }; }) } };
});
const { claimDrop } = await import("../src/drops.js");
const { createAuthChallenge, completeAuth } = await import("../src/auth.js");
const createdDropIds: string[] = [];
const createdTelegramIds: string[] = [];
const createdWallets: string[] = [];
afterAll(async () => {
  await db.claimRequest.deleteMany({ where: { dropId: { in: createdDropIds } } });
  await db.drop.deleteMany({ where: { id: { in: createdDropIds } } });
  await db.user.deleteMany({ where: { OR: [{ telegramId: { in: createdTelegramIds } }, { walletPublicKey: { in: createdWallets } }] } });
  await db.authChallenge.deleteMany({ where: { publicKey: { in: createdWallets } } });
  await db.$disconnect(); await lockPool.end();
});
describe("PostgreSQL transactions and concurrency", () => {
  it("skips an overlapping worker batch and releases its lock after failure", async () => {
    const key = `worker-lock:${randomUUID()}`;
    await withLock(key, async () => {
      const run = vi.fn();
      expect(await tryWithLock(key, run)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });
    await expect(tryWithLock(key, async () => { throw new Error("worker interrupted"); })).rejects.toThrow("worker interrupted");
    const run = vi.fn();
    expect(await tryWithLock(key, run)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
  it("reserves a drop for only one concurrent Telegram receiver", async () => {
    const suffix = randomUUID();
    const telegramIds = [`integration-a-${suffix}`, `integration-b-${suffix}`]; createdTelegramIds.push(...telegramIds);
    const drop = await db.drop.create({ data: { claimCode: "T" + randomUUID().replace(/[-01ILO]/g, "A").slice(0, 7).toUpperCase(), amount: "10", assetIssuer: TESTNET.issuer } }); createdDropIds.push(drop.id);
    const results = await Promise.allSettled(telegramIds.map(id => claimDrop(drop.claimCode, id)));
    expect(results.every(r => r.status === "rejected")).toBe(true);
    const codes = results.map(r => r.status === "rejected" ? r.reason.status : 0).sort();
    expect(codes).toEqual([409, 503]);
    const reservation = await db.claimRequest.findUniqueOrThrow({ where: { dropId: drop.id } });
    const winner = await db.user.findUniqueOrThrow({ where: { id: reservation.userId } });
    expect(telegramIds).toContain(winner.telegramId);
    expect((await db.drop.findUniqueOrThrow({ where: { id: drop.id } })).status).toBe("CREATED");
    await expect(claimDrop(drop.claimCode, winner.telegramId!)).rejects.toMatchObject({ status: 503 });
    expect((await db.claimRequest.findUniqueOrThrow({ where: { dropId: drop.id } })).userId).toBe(winner.id);
  });
  it("accepts a signed wallet challenge exactly once under concurrent requests", async () => {
    const wallet = Keypair.random(); createdWallets.push(wallet.publicKey());
    const challenge = await createAuthChallenge(wallet.publicKey());
    const { parseTransaction } = await import("../src/stellar.js");
    const transaction = parseTransaction(challenge.transaction); transaction.sign(wallet);
    const results = await Promise.allSettled([completeAuth(challenge.challengeId, transaction.toXDR()), completeAuth(challenge.challengeId, transaction.toXDR())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  });
  it("serializes account work across independent database sessions", async () => {
    const key = `integration-lock:${randomUUID()}`; const steps: string[] = [];
    await Promise.all([
      withLock(key, async () => { steps.push("a:start"); await new Promise(resolve => setTimeout(resolve, 80)); steps.push("a:end"); }),
      withLock(key, async () => { steps.push("b:start"); steps.push("b:end"); }),
    ]);
    expect(["a:start,a:end,b:start,b:end", "b:start,b:end,a:start,a:end"]).toContain(steps.join(","));
    await expect(withLock(key, async () => { throw new Error("intentional"); })).rejects.toThrow("intentional");
    expect(await withLock(key, async () => "released")).toBe("released");
  });
  it("does not exhaust the connection pool when concurrent flows take nested locks", async () => {
    const prefix = randomUUID();
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => withLock(`${prefix}:outer:${i}`, () => withLock(`${prefix}:inner:${i}`, async () => i))));
    expect(new Set(results).size).toBe(24);
  });
});
