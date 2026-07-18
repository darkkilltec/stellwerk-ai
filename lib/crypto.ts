import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getAppSecret } from "./secret";

// AES-256-GCM with a versioned payload format `v1:iv:tag:cipher` (base64).
// The version prefix makes future key/format rotation possible without
// guessing what an old payload is.

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getAppSecret(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, cipherText] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !cipherText) {
    throw new Error(`Unsupported secret payload format: ${version ?? "?"}`);
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getAppSecret(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
