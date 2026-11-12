import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TESTNET } from "@stellardrop/shared";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://"),
  STELLAR_HORIZON_URL: z.literal(TESTNET.horizon).default(TESTNET.horizon),
  NETWORK_PASSPHRASE: z.literal(TESTNET.passphrase).default(TESTNET.passphrase),
  USDC_ISSUER: z.literal(TESTNET.issuer).default(TESTNET.issuer),
  ANCHOR_HOME_DOMAIN: z.literal(TESTNET.anchor).default(TESTNET.anchor),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters"),
  JWT_SECRET: z.string().min(32),
  EMAIL_PROVIDER: z.enum(["resend", "smtp"]).default("smtp"),
  RESEND_API_KEY: z.string().default(""),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().regex(/^[^\r\n]+$/).default("StellarDrop <hello@stellardrop.test>"),
  MASTER_ESCROW_PUBLIC_KEY: z.string().default(""),
  MASTER_ESCROW_SECRET_KEY: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_BOT_USERNAME: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_MODE: z.enum(["polling", "webhook", "disabled"]).default("polling"),
  TELEGRAM_WEBHOOK_URL: z.string().default(""),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  ANCHOR_POLL_INTERVAL_MS: z.coerce.number().int().min(3000).default(10000),
});
export const env = schema.parse(process.env);
if (!!env.MASTER_ESCROW_PUBLIC_KEY !== !!env.MASTER_ESCROW_SECRET_KEY) throw new Error("Set both master escrow keys or leave both empty.");
if (env.NODE_ENV === "production" && new URL(env.WEB_ORIGIN).protocol !== "https:") throw new Error("Production WEB_ORIGIN requires HTTPS.");
if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY.trim()) throw new Error("Configure RESEND_API_KEY when EMAIL_PROVIDER=resend.");
if (env.EMAIL_PROVIDER === "smtp" && !!env.SMTP_USER !== !!env.SMTP_PASSWORD) throw new Error("Configure both SMTP_USER and SMTP_PASSWORD.");
if (env.TELEGRAM_MODE === "webhook" && env.TELEGRAM_BOT_TOKEN) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) throw new Error("Webhook secret must be 32–256 URL-safe characters.");
  if (!env.TELEGRAM_WEBHOOK_URL.startsWith("https://")) throw new Error("Telegram webhook URL must use HTTPS.");
}
