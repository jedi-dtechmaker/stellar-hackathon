import { timingSafeEqual } from "node:crypto";
import { getContext } from "@netlify/functions";

export const workerSecretHeader = "X-StellarDrop-Worker-Secret";

function isProductionDeploy() {
  try { return getContext().deploy.context === "production"; }
  catch { return false; }
}

export function authorizedWorker(request: Request) {
  const expected = process.env.WORKER_SECRET;
  const supplied = request.headers.get(workerSecretHeader);
  if (!isProductionDeploy() || request.method !== "POST" || !expected || expected.length < 32 || !supplied) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function triggerWorker() {
  // Preview deployments must never run the production bot or settlement worker.
  if (!isProductionDeploy()) return;
  const secret = process.env.WORKER_SECRET;
  if (!secret || secret.length < 32) throw new Error("Configure WORKER_SECRET with at least 32 random characters.");
  const url = new URL("/.netlify/functions/worker", process.env.WEB_ORIGIN);
  if (url.protocol !== "https:") throw new Error("The worker requires an HTTPS WEB_ORIGIN.");
  const response = await fetch(url, {
    method: "POST",
    headers: { [workerSecretHeader]: secret },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 202) throw new Error("The background worker could not be invoked.");
}
