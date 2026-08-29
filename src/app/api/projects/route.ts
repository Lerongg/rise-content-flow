import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { DEFAULT_STAGES, DEFAULT_VARIABLES } from "@/lib/defaultTemplate";
import { ModelRow } from "@/lib/types";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const clientId = req.nextUrl.searchParams.get("client_id");
  let query = db()
    .from("projects")
    .select("id, client_id, name, description, created_at, clients(name)")
    .order("created_at", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

/** Creates a project pre-filled with the default WPiP stage template and default variables. */
export async function POST(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const body = await req.json();
  if (!body.client_id || !body.name) {
    return Response.json({ error: "client_id i nazwa są wymagane" }, { status: 400 });
  }

  const { data: project, error } = await db()
    .from("projects")
    .insert({
      client_id: body.client_id,
      name: body.name,
      description: body.description || null,
      variables: DEFAULT_VARIABLES,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Map sheet model codes to models configured in the app (best effort)
  const { data: models } = await db().from("models").select("*");
  const byCode = new Map<string, ModelRow>();
  for (const m of (models ?? []) as ModelRow[]) byCode.set(m.model_id, m);

  const stages = DEFAULT_STAGES.map((s, i) => ({
    project_id: project.id,
    position: i + 1,
    name: s.name,
    prompt: s.prompt,
    model_id: s.modelCode ? byCode.get(s.modelCode)?.id ?? null : null,
    temperature: s.temperature,
    top_k: s.topK,
    top_p: s.topP,
    thinking_level: s.thinkingLevel,
    publish_wp_draft: s.publishWpDraft,
    enabled: true,
  }));
  const { error: stageError } = await db().from("stages").insert(stages);
  if (stageError) return Response.json({ error: stageError.message }, { status: 500 });

  return Response.json(project);
}
