import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ModelRow } from "@/lib/types";
import { maskModel } from "@/lib/maskModel";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of [
    "name",
    "provider",
    "model_id",
    "base_url",
    "input_cost_per_1m",
    "output_cost_per_1m",
    "active",
  ]) {
    if (key in body) update[key] = body[key];
  }
  // API key: update only when a new non-empty value is provided; null clears it
  if ("api_key" in body) {
    if (body.api_key === null) update.api_key = null;
    else if (typeof body.api_key === "string" && body.api_key.trim() !== "")
      update.api_key = body.api_key.trim();
  }
  const { data, error } = await db().from("models").update(update).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(maskModel(data as ModelRow));
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { error } = await db().from("models").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
