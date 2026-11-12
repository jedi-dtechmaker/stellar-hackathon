import { Asset, Horizon, Keypair, Operation, Transaction, TransactionBuilder, type Memo } from "@stellar/stellar-sdk";
import { TESTNET } from "@stellardrop/shared";
import { db, withLock } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { env } from "./config.js";
import { AppError, isNotFound } from "./errors.js";
import { fetchExternal } from "./http.js";
import type { Session } from "./auth.js";

export const horizon = new Horizon.Server(TESTNET.horizon, { allowHttp: false });
const horizonAdapter = horizon.httpClient.defaults.adapter!;
horizon.httpClient.defaults.adapter = async config => {
  for (let attempt = 0; ; attempt++) {
    try { return await horizonAdapter({ ...config, timeout: config.timeout && config.timeout > 0 ? config.timeout : 20000, maxRedirects: 0 }); }
    catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (attempt >= 2 || config.method?.toLowerCase() !== "get" || (status && status < 500)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
};
export const usdc = new Asset("USDC", TESTNET.issuer);
let escrow: Keypair | undefined;
export function escrowKey(): Keypair {
  if (!escrow) throw new Error("Escrow has not initialized");
  return escrow;
}
export function parseTransaction(xdr: string): Transaction {
  let tx;
  try { tx = TransactionBuilder.fromXDR(xdr, TESTNET.passphrase); }
  catch { throw new AppError(400, "Invalid Testnet transaction."); }
  if (!(tx instanceof Transaction)) throw new AppError(400, "Fee-bump envelopes are not supported.");
  return tx;
}
export async function accountBalance(publicKey: string) {
  try {
    const account = await horizon.loadAccount(publicKey);
    const line = account.balances.find(b => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === TESTNET.issuer);
    return { balance: line?.balance ?? "0", hasTrustline: !!line, funded: true };
  } catch (error) {
    if (isNotFound(error)) return { balance: "0", hasTrustline: false, funded: false };
    throw error;
  }
}
export async function friendbot(publicKey: string): Promise<void> {
  if ((await accountBalance(publicKey)).funded) return;
  const response = await fetchExternal(`${TESTNET.friendbot}/?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok && !(await accountBalance(publicKey)).funded) throw new AppError(503, "Testnet Friendbot is temporarily unavailable. Retry shortly.");
}
export async function buildTransaction(source: string, operations: ReturnType<typeof Operation.payment>[], memo?: Memo) {
  const account = await horizon.loadAccount(source);
  const fee = String(Math.max(100, Number((await horizon.feeStats()).fee_charged.p70)));
  const builder = new TransactionBuilder(account, { fee, networkPassphrase: TESTNET.passphrase });
  for (const operation of operations) builder.addOperation(operation);
  if (memo) builder.addMemo(memo);
  return builder.setTimeout(300).build();
}
export async function initializeEscrow(fund = true) {
  await withLock("escrow:init", async () => {
    const stored = await db.systemKey.findUnique({ where: { name: "master-escrow" } });
    if (stored) {
      escrow = Keypair.fromSecret(decrypt(stored.encrypted, "master-escrow"));
      if (escrow.publicKey() !== stored.publicKey) throw new Error("Escrow key integrity check failed");
      if (env.MASTER_ESCROW_PUBLIC_KEY && env.MASTER_ESCROW_PUBLIC_KEY !== stored.publicKey) throw new Error("Configured escrow differs from persisted escrow. Refusing to change custody keys.");
    } else {
      escrow = env.MASTER_ESCROW_SECRET_KEY ? Keypair.fromSecret(env.MASTER_ESCROW_SECRET_KEY) : Keypair.random();
      if (env.MASTER_ESCROW_PUBLIC_KEY && escrow.publicKey() !== env.MASTER_ESCROW_PUBLIC_KEY) throw new Error("Master escrow keys do not match");
      await db.systemKey.create({ data: { name: "master-escrow", publicKey: escrow.publicKey(), encrypted: encrypt(escrow.secret(), "master-escrow") } });
    }
  });
  if (fund) await friendbot(escrowKey().publicKey());
}
export async function ensureCustodialUser(telegramId: string) {
  let user = await db.user.upsert({ where: { telegramId }, create: { telegramId }, update: {} });
  if (!user.custodialEncSecKey) {
    const key = Keypair.random();
    user = await db.user.update({ where: { id: user.id }, data: { custodialPubKey: key.publicKey(), custodialEncSecKey: encrypt(key.secret(), `user:${user.id}`) } });
  }
  return user;
}
export function userKey(user: { id: string; custodialEncSecKey: string | null; custodialPubKey: string | null }) {
  if (!user.custodialEncSecKey) throw new AppError(400, "Claim a drop first to create your wallet.");
  const key = Keypair.fromSecret(decrypt(user.custodialEncSecKey, `user:${user.id}`));
  if (key.publicKey() !== user.custodialPubKey) throw new Error("Custodial key integrity check failed");
  return key;
}
export async function emailWalletKey(session: Session) {
  if (session.authMethod !== "email") throw new AppError(403, "This action requires a verified email account.");
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user?.email || !user.emailVerifiedAt || user.custodialPubKey !== session.publicKey) throw new AppError(403, "This wallet does not belong to your email account.");
  return userKey(user);
}
