import { db } from "./db.js";
import { env } from "./config.js";
import { reconcileLedgerJobs } from "./ledger.js";
import { pollWithdrawals } from "./anchor.js";
import { bot, processTelegramQueue } from "./bot.js";

// One durable batch, shared by the local interval and Netlify's background function.
export async function runBackgroundJobs() {
  await reconcileLedgerJobs();
  const activeBot = env.TELEGRAM_MODE === "disabled" ? undefined : bot;
  await pollWithdrawals(activeBot ? (id, text) => activeBot.telegram.sendMessage(id, text) : undefined);
  if (activeBot) await processTelegramQueue();
  await db.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  await db.emailChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
  await db.telegramUpdate.deleteMany({ where: { processedAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
}
