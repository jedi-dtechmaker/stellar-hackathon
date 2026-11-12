import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config.js";
import { logger } from "../src/errors.js";
import { sendVerificationEmail, verifyEmailTransport } from "../src/email.js";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), verify: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => smtp } }));
vi.mock("../src/config.js", () => ({ env: {
  EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_only", EMAIL_FROM: "StellarDrop <hello@example.com>",
} }));

beforeEach(() => {
  env.EMAIL_PROVIDER = "resend";
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("verification email delivery", () => {
  it("does not call an email provider when email sign-in is disabled", async () => {
    env.EMAIL_PROVIDER = "disabled";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(sendVerificationEmail("person@example.com", "012345")).rejects.toMatchObject({ status: 503, code: "EMAIL_AUTH_DISABLED" });
    expect(fetch).not.toHaveBeenCalled(); expect(smtp.sendMail).not.toHaveBeenCalled();
  });
  it("sends the verification code through Resend with a bounded HTTPS request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "email-id" })); vi.stubGlobal("fetch", fetch);
    await sendVerificationEmail("person@example.com", "012345");
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST", redirect: "error", signal: expect.any(AbortSignal),
      headers: { Authorization: "Bearer re_test_only", "Content-Type": "application/json" },
    }));
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({ from: env.EMAIL_FROM, to: ["person@example.com"], subject: "Your StellarDrop verification code" });
    expect(body.text).toContain("012345"); expect(body.html).toContain("012345");
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])("returns a safe delivery error for Resend HTTP %s", async status => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "private provider response" }, { status })));
    await expect(sendVerificationEmail("person@example.com", "012345")).rejects.toMatchObject({ status: 503, code: "EMAIL_DELIVERY_FAILED" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/012345|re_test_only|person@example.com|private provider response/);
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
  it("handles network failures without exposing the provider error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret provider details")));
    await expect(sendVerificationEmail("person@example.com", "012345")).rejects.toMatchObject({ status: 503, message: "We couldn't send your code. Please try again shortly." });
  });
  it.each([{}, { id: "" }, { id: 123 }, null])("rejects a response without an accepted email ID: %j", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
    await expect(sendVerificationEmail("person@example.com", "012345")).rejects.toMatchObject({ code: "EMAIL_DELIVERY_FAILED" });
  });
  it("preserves Mailpit/SMTP delivery when explicitly selected", async () => {
    env.EMAIL_PROVIDER = "smtp";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    smtp.sendMail.mockResolvedValue({ accepted: ["person@example.com"] });
    await sendVerificationEmail("person@example.com", "012345");
    expect(smtp.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["person@example.com"], text: expect.stringContaining("012345") }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an SMTP response that accepts no recipients", async () => {
    env.EMAIL_PROVIDER = "smtp"; smtp.sendMail.mockResolvedValue({ accepted: [] });
    await expect(sendVerificationEmail("person@example.com", "012345")).rejects.toMatchObject({ code: "EMAIL_DELIVERY_FAILED" });
  });
  it("prevents the SMTP connection check from reporting success for Resend", async () => {
    await expect(verifyEmailTransport()).rejects.toMatchObject({ code: "EMAIL_PROVIDER_MISMATCH" });
    expect(smtp.verify).not.toHaveBeenCalled();
  });
});
