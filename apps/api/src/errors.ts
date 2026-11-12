import pino from "pino";
export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : "info",
  redact: ["secret", "token", "authorization", "signedXdr", "encryptedToken", "payload", "custodialEncSecKey", "interactiveUrl"],
});
export class AppError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") { super(message); }
}
export function safeMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "The service is temporarily unavailable. Please retry; your operation will be reconciled safely.";
}
export function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}
