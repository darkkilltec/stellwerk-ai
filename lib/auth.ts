import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAppSecret } from "./secret";

// Stateless single-user session: the cookie holds `exp.signature` where
// signature = HMAC-SHA256(exp) with the app secret — the same secret that
// encrypts settings, so a fresh checkout needs no extra key material.

export const SESSION_COOKIE = "stellwerk_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", getAppSecret())
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionToken(token: string, now = Date.now()): boolean {
  const [exp, signature] = token.split(".");
  if (!exp || !signature) return false;
  const expected = Buffer.from(sign(exp));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  if (!timingSafeEqual(expected, actual)) return false;
  return Number(exp) > now;
}

export async function isAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : false;
}

export async function startSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
