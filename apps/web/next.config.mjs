import nextEnv from "@next/env";
import path from "node:path";
nextEnv.loadEnvConfig(path.resolve(process.cwd(), "../.."));
export default {
  transpilePackages: ["@stellardrop/shared"],
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
