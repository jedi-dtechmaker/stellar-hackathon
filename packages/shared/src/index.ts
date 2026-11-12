export const TESTNET = Object.freeze({
  horizon: "https://horizon-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  anchor: "testanchor.stellar.org",
  anchorInteractiveOrigin: "https://anchor-ref-ui-testanchor.stellar.org",
  friendbot: "https://friendbot.stellar.org",
  assetCode: "USDC",
});

export function units(value: string): bigint {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,7})?$/.test(value)) throw new Error("Use a positive amount with at most 7 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

export function amountFromUnits(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  const fraction = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${sign}${n / 10_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeAmount(value: string): string {
  const n = units(value);
  if (n <= 0n || n > 10_000_000_000_000n) throw new Error("Amount must be between 0.0000001 and 1,000,000 USDC.");
  return amountFromUnits(n);
}

export type DropStatus = "CREATED" | "CLAIMED" | "WITHDRAWN" | "EXPIRED";
export type AuthMethod = "wallet" | "email";
export interface SessionIdentity { publicKey: string; authMethod: AuthMethod; email: string | null }
export interface SessionData extends SessionIdentity { token: string }
export interface EmailCodeRequest { challengeId: string; email: string; expiresAt: string; resendAt: string }
export interface PublicDrop {
  claimCode: string;
  amount: string;
  assetCode: string;
  status: DropStatus;
  createdAt: string;
}
export interface SenderDrop extends PublicDrop {
  id: string;
  stellarBalanceId: string | null;
  transactions: { txHash: string; type: string; status: string }[];
}
export interface DashboardData {
  drops: SenderDrop[];
  stats: { totalSent: string; activeDrops: number; claimRate: number; totalDrops: number };
  wallet: { publicKey: string; balance: string; hasTrustline: boolean; funded: boolean };
}
