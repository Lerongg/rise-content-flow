import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sweepStalledJobs } from "@/lib/chain";

// Publiczny healthcheck + keep-alive dla Supabase (darmowy plan pauzuje projekt
// po ~7 dniach bez aktywności; dzienne zapytanie z Vercel Cron temu zapobiega).
// Dodatkowo wskrzesza martwe łańcuchy wykonywania. Nie zwraca danych poza statusem.
export async function GET(req: NextRequest) {
  try {
    await sweepStalledJobs(req);
    const { count, error } = await db()
      .from("models")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, db: true, models: count ?? 0 });
  } catch (e) {
    return Response.json(
      { ok: false, db: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    );
  }
}
