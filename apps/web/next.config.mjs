import nextEnv from "@next/env";
import path from "node:path";
nextEnv.loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV === "development", undefined, true);
export default {
  transpilePackages: ["@stellardrop/shared"],
  env: { NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "") },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
