import type { Telegram } from "telegraf";
import { TelegramError } from "telegraf";
import { env } from "./config.js";
import { fetchExternal } from "./http.js";

// All methods used by this text-only bot share the bounded, redacted JSON HTTP
// transport. Telegraf continues to own command routing, contexts, and polling.
export const telegramCall: Telegram["callApi"] = async (method, payload, options = {}) => {
  const controller = new AbortController();
  const signal = options.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort);
  try {
    const response = await fetchExternal(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal,
    }, method === "getUpdates" ? 65000 : 20000);
    const data = await response.json() as { ok: boolean; result: never; error_code: number; parameters?: { retry_after?: number } };
    if (!response.ok || !data.ok) throw new TelegramError({ error_code: data.error_code || response.status, description: "Telegram request failed", parameters: data.parameters });
    return data.result;
  } catch (error) {
    if (controller.signal.aborted) { const aborted = new Error("Telegram request cancelled"); aborted.name = "AbortError"; throw aborted; }
    if (error instanceof TelegramError) throw error;
    // Do not propagate fetch errors containing the URL, which includes a token.
    throw new TelegramError({ error_code: 503, description: "Telegram network unavailable" });
  } finally { signal?.removeEventListener("abort", abort); }
};
