import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("email configuration", () => {
  it("supports wallet sign-in without email provider credentials", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "disabled"); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("SMTP_USER", "unused-smtp-user");
    expect((await import("../src/config.js")).env.EMAIL_PROVIDER).toBe("disabled");
  });
  it("requires a Resend API key when Resend is selected", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend"); vi.stubEnv("RESEND_API_KEY", "");
    await expect(import("../src/config.js")).rejects.toThrow("Configure RESEND_API_KEY");
  });
  it("ignores unused SMTP credentials when using Resend", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend"); vi.stubEnv("RESEND_API_KEY", "re_test_only"); vi.stubEnv("SMTP_USER", "unused-smtp-user");
    expect((await import("../src/config.js")).env.EMAIL_PROVIDER).toBe("resend");
  });
  it("continues validating paired SMTP credentials when using SMTP", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "smtp"); vi.stubEnv("SMTP_USER", "smtp-user");
    await expect(import("../src/config.js")).rejects.toThrow("Configure both SMTP_USER and SMTP_PASSWORD");
  });
});
