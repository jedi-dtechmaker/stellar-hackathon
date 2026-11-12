import { verifyEmailTransport } from "../src/email.js";
import { AppError } from "../src/errors.js";

try {
  await verifyEmailTransport();
  console.log("SMTP connection and authentication succeeded. No email was sent.");
} catch (error) {
  console.error(error instanceof AppError ? error.message : "SMTP verification failed. Credentials are not logged.");
  process.exitCode = 1;
}
