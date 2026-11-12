import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });
export default defineConfig({ test: {
  fileParallelism: false,
  testTimeout: 30000,
  env: {
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://stellardrop:stellardrop@localhost:5432/stellardrop?schema=public",
    ENCRYPTION_KEY: "ab".repeat(32), JWT_SECRET: "unit-test-session-secret-keep-it-over-32-characters",
    TELEGRAM_MODE: "disabled", TELEGRAM_BOT_TOKEN: "", TELEGRAM_WEBHOOK_SECRET: "webhook-test-secret-32-characters-long",
    EMAIL_PROVIDER: "smtp", RESEND_API_KEY: "",
    SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", SMTP_SECURE: "false", SMTP_USER: "", SMTP_PASSWORD: "",
    EMAIL_FROM: "StellarDrop <tests@stellardrop.test>",
  },
} });
