import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { data, error } = await db().from("clients").select("*").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  const { data: projects } = await db()
    .from("projects")
    .select("id, name, description, created_at, jobs(count)")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
  return Response.json({ ...data, projects: projects ?? [] });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of [
    "name",
    "website",
    "ton_glosu",
    "brandbook",
    "wytyczne",
    "baza_wiedzy",
    "dane_1",
    "dane_2",
    "extra_json",
    "wp_enabled",
    "wp_url",
    "wp_username",
    "wp_app_password",
  ]) {
    if (key in body) update[key] = body[key];
  }
  const { data, error } = await db().from("clients").update(update).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { error } = await db().from("clients").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
