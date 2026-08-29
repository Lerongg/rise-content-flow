import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "rcf_auth";

function secret(): string {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || "dev-secret";
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function makeToken(): string {
  return createHmac("sha256", secret()).update("rcf-session-v1").digest("hex");
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authEnabled()) return true;
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const expected = makeToken();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** For API routes: returns a 401 Response when not authenticated, otherwise null. */
export async function requireAuth(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "Brak autoryzacji" }, { status: 401 });
}

export const AUTH_COOKIE = COOKIE_NAME;
