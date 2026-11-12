import nodemailer from "nodemailer";
import { env } from "./config.js";
import { AppError, logger } from "./errors.js";

const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  requireTLS: env.NODE_ENV === "production" && !env.SMTP_SECURE,
  ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  disableFileAccess: true,
  disableUrlAccess: true,
  logger: false,
  debug: false,
});

export async function verifyEmailTransport() {
  if (env.EMAIL_PROVIDER !== "smtp") throw new AppError(400, "smtp:verify requires EMAIL_PROVIDER=smtp. Test Resend by requesting a code on /login.", "EMAIL_PROVIDER_MISMATCH");
  try { await mailer.verify(); }
  catch (error) {
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/.test(rawCode) ? rawCode : "SMTP_ERROR";
    throw new AppError(503, `SMTP connection check failed (${code}). Check the provider host, port, TLS mode, and credentials.`, "SMTP_UNAVAILABLE");
  }
}

export async function sendVerificationEmail(email: string, code: string) {
  if (env.EMAIL_PROVIDER === "disabled") throw new AppError(503, "Email sign-in is unavailable. Connect with Freighter on Stellar Testnet.", "EMAIL_AUTH_DISABLED");
  try {
    const message = {
      from: env.EMAIL_FROM,
      to: [email],
      subject: "Your StellarDrop verification code",
      text: `Your StellarDrop code is ${code}.\n\nEnter this code on StellarDrop to sign in. It expires in 10 minutes and can only be used once.\n\nAfter verification, we create and securely manage your Stellar Testnet wallet. Returning users keep their existing wallet.\n\nNever share this code. If you didn't request it, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;color:#20281f;max-width:480px;margin:auto;padding:32px"><h1 style="font-size:24px">Your next good thing starts here.</h1><p>Use this code to sign in to StellarDrop:</p><p style="font-size:36px;letter-spacing:8px;background:#e5f0d1;padding:24px;border-radius:12px;text-align:center">${code}</p><p>This code expires in 10 minutes and works once. Never share it.</p><p>After verification, we create and securely manage your Stellar Testnet wallet. Returning users keep their existing wallet.</p><p style="color:#798073;font-size:12px">If you didn't request this code, you can ignore this email.</p></div>`,
    };
    if (env.EMAIL_PROVIDER === "resend") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Resend rejected the email");
      const result = await response.json() as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) throw new Error("Resend did not accept the email");
    } else {
      const delivery = await mailer.sendMail(message);
      if (!delivery.accepted?.length) throw new Error("Email was not accepted");
    }
  } catch {
    logger.warn({ provider: env.EMAIL_PROVIDER }, "Verification email could not be delivered. Check the email provider configuration; credentials and codes are not logged.");
    throw new AppError(503, "We couldn't send your code. Please try again shortly.", "EMAIL_DELIVERY_FAILED");
  }
}
