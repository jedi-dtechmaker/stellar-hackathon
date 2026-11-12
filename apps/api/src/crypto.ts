import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./config.js";

export function encrypt(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(".");
}
export function decrypt(value: string, context: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !/^[a-f0-9]{24}$/.test(parts[1]!) || !/^[a-f0-9]{32}$/.test(parts[2]!) || !/^(?:[a-f0-9]{2})+$/.test(parts[3]!)) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "hex"), Buffer.from(parts[1]!, "hex"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(parts[2]!, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "hex")), decipher.final()]).toString("utf8");
}
export function secretMatches(a: string | undefined, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
