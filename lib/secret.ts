import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// App secret for encrypting settings at rest. Lives outside the repo and
// outside the image: ./.data/app-secret in dev (gitignored), /data/app-secret
// on the appdata volume in the container (SECRET_FILE env). Generated on
// first access.
const DEFAULT_SECRET_FILE = ".data/app-secret";

let cached: Buffer | null = null;

export function getAppSecret(): Buffer {
  if (cached) return cached;
  const file = process.env.SECRET_FILE ?? DEFAULT_SECRET_FILE;
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32), { mode: 0o600 });
  }
  const secret = readFileSync(file);
  if (secret.length !== 32) {
    throw new Error(
      `App secret at ${file} has ${secret.length} bytes, expected 32 — delete the file to regenerate (stored API keys become unreadable)`,
    );
  }
  cached = secret;
  return secret;
}
