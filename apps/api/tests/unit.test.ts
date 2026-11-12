import { describe, expect, it } from "vitest";
import { amountFromUnits, normalizeAmount, TESTNET, units } from "@stellardrop/shared";
import { decrypt, encrypt, secretMatches } from "../src/crypto.js";
import { allocateWithdrawal, trustedAnchorUrl, trustedInteractiveUrl, withdrawalMemo } from "../src/anchor.js";
import { normalizedCode } from "../src/drops.js";
import { sanitizeUpdate } from "../src/bot.js";
import { parseTransaction } from "../src/stellar.js";
import { Account, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

describe("exact Stellar amounts", () => {
  it("preserves stroops without floating point rounding", () => {
    expect(amountFromUnits(units("0.1000001") + units("0.2"))).toBe("0.3000001");
    expect(normalizeAmount("10.0000000")).toBe("10");
    expect(normalizeAmount("0.0000001")).toBe("0.0000001");
  });
  it.each(["-1", "0", "1e3", "0.00000001", "1.12345678", "NaN", "Infinity", "1,000", " 10", "01", "1000001"])("rejects invalid amount %s", value => expect(() => normalizeAmount(value)).toThrow());
});
describe("authenticated key encryption", () => {
  it("uses independent nonces and a context-bound authenticated ciphertext", () => {
    const secret = Keypair.random().secret();
    const a = encrypt(secret, "user:1"), b = encrypt(secret, "user:1");
    expect(a).not.toBe(b); expect(a).not.toContain(secret); expect(decrypt(a, "user:1")).toBe(secret);
    expect(() => decrypt(a, "user:2")).toThrow();
    expect(() => decrypt(a.slice(0, -2) + (a.endsWith("ff") ? "00" : "ff"), "user:1")).toThrow();
  });
  it("rejects malformed encrypted envelopes", () => expect(() => decrypt("v1.bad", "user:1")).toThrow());
  it("rejects empty and incorrect webhook secrets", () => { expect(secretMatches(undefined, "secret")).toBe(false); expect(secretMatches("", "")).toBe(false); expect(secretMatches("wrong", "secret")).toBe(false); expect(secretMatches("secret", "secret")).toBe(true); });
});
describe("withdrawal allocation and anchor boundary", () => {
  it("allocates partial withdrawals against the oldest unwithdrawn drops", () => {
    expect(allocateWithdrawal([{ id: "a", amount: "10", withdrawnAmount: "8" }, { id: "b", amount: "10", withdrawnAmount: "0" }], "7")).toEqual([{ dropId: "a", amount: "2" }, { dropId: "b", amount: "5" }]);
  });
  it("cannot allocate more than the tracked balance", () => expect(() => allocateWithdrawal([{ id: "a", amount: "2", withdrawnAmount: "1" }], "2")).toThrow());
  it.each(["http://testanchor.stellar.org/", "https://testanchor.stellar.org.evil.example/", "https://evil.example/", "https://user:test@testanchor.stellar.org/", "https://testanchor.stellar.org:444/"])("rejects an untrusted anchor URL %s", url => expect(() => trustedAnchorUrl(url)).toThrow());
  it("uses only the exact HTTPS anchor origin", () => expect(trustedAnchorUrl("https://testanchor.stellar.org/sep24/interactive").hostname).toBe(TESTNET.anchor));
  it("allows the SDF anchor's official hosted UI without broadening the API origin", () => {
    expect(trustedInteractiveUrl(`${TESTNET.anchorInteractiveOrigin}/?test=1`).origin).toBe(TESTNET.anchorInteractiveOrigin);
    expect(() => trustedAnchorUrl(TESTNET.anchorInteractiveOrigin)).toThrow();
    expect(() => trustedInteractiveUrl("https://anchor-ref-ui-testanchor.stellar.org.evil.example/")).toThrow();
    expect(() => trustedInteractiveUrl("http://anchor-ref-ui-testanchor.stellar.org/")).toThrow();
  });
  it("preserves 64-bit memo IDs and validates memo lengths", () => {
    expect(withdrawalMemo("id", "18446744073709551615")?.value).toBe("18446744073709551615");
    expect(() => withdrawalMemo("id", "18446744073709551616")).toThrow();
    expect(() => withdrawalMemo("text", "a".repeat(29))).toThrow();
    expect(() => withdrawalMemo("hash", "bad")).toThrow();
  });
});
describe("claim and Telegram input", () => {
  it("normalizes claim codes and rejects injected or ambiguous input", () => { expect(normalizedCode(" abcd2345 ")).toBe("ABCD2345"); expect(() => normalizedCode("ABCD0123")).toThrow(); expect(() => normalizedCode("../../etc")).toThrow(); });
  it("discards non-command messages and bank data", () => {
    expect(sanitizeUpdate({ update_id: 1, message: { from: { id: 1 }, chat: { type: "private", id: 1 }, text: "My bank details are private" } })).toBeNull();
    const clean = sanitizeUpdate({ update_id: 1, message: { message_id: 1, date: 1, from: { id: 1, first_name: "PII", username: "private" }, chat: { type: "private", id: 1 }, text: "/balance" } });
    expect(JSON.stringify(clean)).not.toContain("PII"); expect(JSON.stringify(clean)).not.toContain("username");
    expect((clean as any)?.message.text).toBe("/balance");
  });
  it("binds transaction hashes to the Testnet network passphrase", () => {
    const key = Keypair.random();
    const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), { fee: "100", networkPassphrase: TESTNET.passphrase }).addOperation(Operation.manageData({ name: "test", value: "test" })).setTimeout(60).build();
    const parsed = parseTransaction(tx.toXDR());
    expect(Buffer.from(parsed.hash()).equals(Buffer.from(tx.hash()))).toBe(true);
    const mainnet = TransactionBuilder.fromXDR(tx.toXDR(), "Public Global Stellar Network ; September 2015");
    expect(Buffer.from(parsed.hash()).equals(Buffer.from(mainnet.hash()))).toBe(false);
  });
});
