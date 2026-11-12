import { isNotFound } from "./errors.js";

export async function retryRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || isNotFound(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
export async function fetchExternal(url: string | URL, init: RequestInit = {}, timeoutMs = 20000) {
  const request = () => fetch(url, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  // Never automatically repeat a state-changing anchor request. Ledger retries
  // are handled separately by exact envelope hash in the durable job service.
  return !init.method || init.method === "GET" ? retryRead(request) : request();
}
