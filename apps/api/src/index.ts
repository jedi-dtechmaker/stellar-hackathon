import { createApp } from "./app.js";
import { env } from "./config.js";
import { db, lockPool } from "./db.js";
import { logger } from "./errors.js";
import { escrowKey, initializeEscrow } from "./stellar.js";
import { ensureTrustline } from "./drops.js";
import { bot, startBot } from "./bot.js";
import { runBackgroundJobs } from "./jobs.js";

await db.$connect();
await initializeEscrow();
await ensureTrustline(escrowKey());
try { await startBot(); }
catch {
  logger.error("Unable to initialize Telegram. Check the bot token and network connection; credentials are not logged.");
  await db.$disconnect(); await lockPool.end(); process.exit(1);
}
if (!bot) logger.warn("TELEGRAM_BOT_TOKEN is unset. Web and API are available; configure a BotFather token to enable claims in Telegram.");
const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT, network: "TESTNET", escrow: escrowKey().publicKey() }, "StellarDrop API ready"));
let stopping = false;
let working = false;
async function tick() {
  if (working || stopping) return;
  working = true;
  try {
    await runBackgroundJobs();
  } catch { logger.error("Background services interrupted; next tick will retry"); }
  finally { working = false; }
}
const interval = setInterval(() => void tick(), env.ANCHOR_POLL_INTERVAL_MS);
void tick();
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  logger.info({ signal }, "Stopping StellarDrop");
  try { if (bot && env.TELEGRAM_MODE === "polling") bot.stop(signal); } catch { /* polling may already be stopped */ }
  server.close();
  const deadline = Date.now() + 30000;
  while (working && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  await db.$disconnect();
  await lockPool.end();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
