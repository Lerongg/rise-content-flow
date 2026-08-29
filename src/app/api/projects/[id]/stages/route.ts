import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Bulk save of a project's stages. Replaces the full ordered list:
 * stages with an id are updated, new ones inserted, missing ones deleted.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id: projectId } = await ctx.params;
  const body = (await req.json()) as { stages: Array<Record<string, unknown>> };
  if (!Array.isArray(body.stages)) {
    return Response.json({ error: "Wymagana lista etapów" }, { status: 400 });
  }

  const { data: existing, error: exErr } = await db()
    .from("stages")
    .select("id")
    .eq("project_id", projectId);
  if (exErr) return Response.json({ error: exErr.message }, { status: 500 });
  const existingIds = new Set((existing ?? []).map((s) => s.id as string));
  const keptIds = new Set<string>();

  for (let i = 0; i < body.stages.length; i++) {
    const s = body.stages[i];
    const row = {
      project_id: projectId,
      position: i + 1,
      name: (s.name as string) || `Etap ${i + 1}`,
      prompt: (s.prompt as string) ?? "",
      model_id: (s.model_id as string) || null,
      temperature: s.temperature === "" || s.temperature == null ? null : Number(s.temperature),
      top_k: s.top_k === "" || s.top_k == null ? null : Number(s.top_k),
      top_p: s.top_p === "" || s.top_p == null ? null : Number(s.top_p),
      thinking_level: (s.thinking_level as string) || null,
      max_output_tokens:
        s.max_output_tokens === "" || s.max_output_tokens == null
          ? null
          : Number(s.max_output_tokens),
      publish_wp_draft: Boolean(s.publish_wp_draft),
      enabled: s.enabled !== false,
    };
    if (typeof s.id === "string" && existingIds.has(s.id)) {
      keptIds.add(s.id);
      const { error } = await db().from("stages").update(row).eq("id", s.id);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await db().from("stages").insert(row);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }
  }

  const toDelete = [...existingIds].filter((eid) => !keptIds.has(eid));
  if (toDelete.length) {
    const { error } = await db().from("stages").delete().in("id", toDelete);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  const { data: stages, error } = await db()
    .from("stages")
    .select("*")
    .eq("project_id", projectId)
    .order("position");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(stages);
}
