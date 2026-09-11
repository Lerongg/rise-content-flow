import { db } from "@/lib/db";

// Publiczny healthcheck + keep-alive dla Supabase (darmowy plan pauzuje projekt
// po ~7 dniach bez aktywności; dzienne zapytanie z Vercel Cron temu zapobiega).
// Nie zwraca żadnych danych poza statusem.
export async function GET() {
  try {
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
