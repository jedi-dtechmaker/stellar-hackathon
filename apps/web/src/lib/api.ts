export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");
export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: { token?: string | null; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: options.signal, cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? "Unable to reach StellarDrop. Please try again.", data.code ?? "REQUEST_FAILED", response.status);
  return data as T;
}
export type PlatformConfig = { botUsername: string | null; escrowPublicKey: string; network: string; anchorDomain: string };
export function shortAddress(address: string) { return `${address.slice(0, 5)}…${address.slice(-5)}`; }
export function displayAmount(amount: string) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 7 }).format(Number(amount)); }
