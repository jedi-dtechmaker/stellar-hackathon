import { createHmac } from "node:crypto";
import { z } from "zod";
import { env } from "./config.js";
import { secretMatches } from "./crypto.js";
import { AppError } from "./errors.js";

// Telegram Mini App initData can authenticate the read-only balance endpoint.
// A public Telegram ID, query parameter, or unsigned user JSON is never enough.
export function verifyTelegramInitData(raw: string): string {
  if (!env.TELEGRAM_BOT_TOKEN || raw.length > 8000) throw new AppError(401, "Telegram authentication is unavailable.");
  const data = new URLSearchParams(raw);
  if (new Set([...data.keys()]).size !== [...data.keys()].length) throw new AppError(401, "Invalid Telegram authentication.");
  const hash = data.get("hash");
  const timestamp = Number(data.get("auth_date"));
  const now = Date.now() / 1000;
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !Number.isFinite(timestamp) || timestamp > now + 30 || now - timestamp > 300) throw new AppError(401, "Telegram authentication expired.");
  data.delete("hash");
  const check = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(env.TELEGRAM_BOT_TOKEN).digest();
  const expected = createHmac("sha256", key).update(check).digest("hex");
  if (!secretMatches(hash, expected)) throw new AppError(401, "Invalid Telegram authentication signature.");
  try { return String(z.object({ id: z.number().int().positive().safe() }).parse(JSON.parse(data.get("user") ?? "null")).id); }
  catch { throw new AppError(401, "Invalid Telegram user."); }
}
