import type { Config } from "@netlify/functions";
import { triggerWorker } from "../lib/worker.js";

export default async function scheduleWorker() {
  await triggerWorker();
  return new Response(null, { status: 204 });
}

export const config: Config = { schedule: "* * * * *" };
