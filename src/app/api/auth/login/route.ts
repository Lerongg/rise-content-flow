import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, makeToken, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!verifyPassword(password ?? "")) {
    return NextResponse.json({ error: "Nieprawidłowe hasło" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
