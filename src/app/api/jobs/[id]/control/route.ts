import { NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { JobRow, ProjectRow, VariableDef } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Job control actions:
 *  - start  : validates required variables, sets status=running (resumes from current_position)
 *  - stop   : requests a stop; the runner halts after the in-flight stage finishes
 *  - reset  : deletes all stage runs and starts over from stage 1
 *  - resume : alias of start (kept for clarity in the UI)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  const { data: job, error } = await db().from("jobs").select("*").eq("id", id).single();
  if (error) return Response.json({ error: error.message }, { status: 404 });
  const j = job as JobRow;

  switch (action) {
    case "start":
    case "resume": {
      if (j.status === "running") {
        return Response.json({ error: "Zapytanie już jest uruchomione" }, { status: 409 });
      }
      const { data: project } = await db()
        .from("projects")
        .select("*")
        .eq("id", j.project_id)
        .single();
      const missing = ((project as ProjectRow)?.variables ?? [])
        .filter((v: VariableDef) => v.required && !String(j.variables?.[v.key] ?? "").trim())
        .map((v: VariableDef) => v.key);
      if (missing.length) {
        return Response.json(
          { error: `Brak wymaganych zmiennych: ${missing.join(", ")}` },
          { status: 400 }
        );
      }
      const { data, error: uErr } = await db()
        .from("jobs")
        .update({
          status: "running",
          stop_requested: false,
          error: null,
          started_at: j.started_at ?? new Date().toISOString(),
          finished_at: null,
        })
        .eq("id", id)
        .select()
        .single();
      if (uErr) return Response.json({ error: uErr.message }, { status: 500 });
      await logEvent("info", `Uruchomiono zapytanie (od etapu ${j.current_position + 1})`, {}, id);
      return Response.json(data);
    }

    case "stop": {
      const { data, error: uErr } = await db()
        .from("jobs")
        .update({
          stop_requested: true,
          status: j.status === "running" ? "stopped" : j.status,
        })
        .eq("id", id)
        .select()
        .single();
      if (uErr) return Response.json({ error: uErr.message }, { status: 500 });
      await logEvent("info", "Zatrzymano zapytanie", {}, id);
      return Response.json(data);
    }

    case "reset": {
      const { error: dErr } = await db().from("stage_runs").delete().eq("job_id", id);
      if (dErr) return Response.json({ error: dErr.message }, { status: 500 });
      const { data, error: uErr } = await db()
        .from("jobs")
        .update({
          status: "pending",
          stop_requested: false,
          current_position: 0,
          error: null,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cost: 0,
          wp_draft_url: null,
          started_at: null,
          finished_at: null,
        })
        .eq("id", id)
        .select()
        .single();
      if (uErr) return Response.json({ error: uErr.message }, { status: 500 });
      await logEvent("info", "Zresetowano zapytanie (od początku)", {}, id);
      return Response.json(data);
    }

    default:
      return Response.json({ error: `Nieznana akcja: ${action}` }, { status: 400 });
  }
}
