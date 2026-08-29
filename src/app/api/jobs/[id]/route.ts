import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { data: job, error } = await db()
    .from("jobs")
    .select("*, projects(id, name, client_id, variables, clients(id, name))")
    .eq("id", id)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  const { data: runs } = await db()
    .from("stage_runs")
    .select("*")
    .eq("job_id", id)
    .order("position")
    .order("started_at");
  const { data: stages } = await db()
    .from("stages")
    .select("*, models(name, provider, model_id)")
    .eq("project_id", job.project_id)
    .order("position");
  return Response.json({ ...job, runs: runs ?? [], stages: stages ?? [] });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of ["name", "variables"]) {
    if (key in body) update[key] = body[key];
  }
  const { data, error } = await db().from("jobs").update(update).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { error } = await db().from("jobs").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
