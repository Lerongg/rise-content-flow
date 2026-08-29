import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ProjectRow, VariableDef } from "@/lib/types";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const projectId = req.nextUrl.searchParams.get("project_id");
  let query = db()
    .from("jobs")
    .select(
      "id, project_id, name, status, variables, current_position, error, total_input_tokens, total_output_tokens, total_cost, wp_draft_url, created_at, started_at, finished_at, projects(name, client_id, clients(name))"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const body = await req.json();
  if (!body.project_id) {
    return Response.json({ error: "project_id jest wymagany" }, { status: 400 });
  }

  const { data: project, error: pErr } = await db()
    .from("projects")
    .select("*")
    .eq("id", body.project_id)
    .single();
  if (pErr) return Response.json({ error: pErr.message }, { status: 404 });

  const variables: Record<string, string> = body.variables ?? {};
  const missing = ((project as ProjectRow).variables ?? [])
    .filter((v: VariableDef) => v.required && !String(variables[v.key] ?? "").trim())
    .map((v: VariableDef) => v.key);
  if (missing.length) {
    return Response.json(
      { error: `Brak wymaganych zmiennych: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const { data, error } = await db()
    .from("jobs")
    .insert({
      project_id: body.project_id,
      name: body.name || variables["SŁOWO_KLUCZOWE"] || null,
      variables,
      status: "pending",
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
