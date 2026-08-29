import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const level = req.nextUrl.searchParams.get("level");
  const jobId = req.nextUrl.searchParams.get("job_id");
  let query = db().from("logs").select("*").order("created_at", { ascending: false }).limit(300);
  if (level) query = query.eq("level", level);
  if (jobId) query = query.eq("job_id", jobId);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { error } = await db().from("logs").delete().gte("id", 0);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
