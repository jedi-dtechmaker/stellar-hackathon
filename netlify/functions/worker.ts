import type { Config } from "@netlify/functions";
import { authorizedWorker } from "../lib/worker.js";

export default async function worker(request: Request) {
  if (!authorizedWorker(request)) return new Response(null, { status: 403 });

  const [{ tryWithLock }, { initializeEscrow, escrowKey }, { ensureTrustline }, { runBackgroundJobs }] = await Promise.all([
    import("../../apps/api/src/db.js"),
    import("../../apps/api/src/stellar.js"),
    import("../../apps/api/src/drops.js"),
    import("../../apps/api/src/jobs.js"),
  ]);
  await tryWithLock("netlify:background-jobs", async () => {
    await initializeEscrow();
    await ensureTrustline(escrowKey());
    await runBackgroundJobs();
  });
  return new Response(null, { status: 204 });
}

export const config: Config = { background: true };
