import { startBot } from "../src/bot.js";
import { env } from "../src/config.js";

try {
  if (env.TELEGRAM_MODE !== "webhook" || !env.TELEGRAM_BOT_TOKEN) throw new Error("Configure TELEGRAM_MODE=webhook, the bot token, webhook secret, and HTTPS webhook URL first.");
  await startBot();
  console.log("Telegram webhook and commands configured successfully.");
} catch {
  console.error("Telegram webhook setup failed. Check the bot settings and network connection; credentials are not logged.");
  process.exitCode = 1;
}
