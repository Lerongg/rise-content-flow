import { NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildContext, interpolate } from "@/lib/interpolate";
import { calcCost, callLlm } from "@/lib/providers";
import { publishWpDraft } from "@/lib/wordpress";
import { maskModel } from "@/lib/maskModel";
import { ClientRow, JobRow, ModelRow, StageRow, StageRunRow } from "@/lib/types";

// One stage per invocation — keeps each request within serverless limits
// and makes stop/resume natural.
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id: jobId } = await ctx.params;

  const { data: jobData, error: jErr } = await db()
    .from("jobs")
    .select("*, projects(*, clients(*))")
    .eq("id", jobId)
    .single();
  if (jErr) return Response.json({ error: jErr.message }, { status: 404 });
  const job = jobData as JobRow & {
    projects: { id: string; clients: ClientRow };
  };

  if (job.stop_requested) {
    await db().from("jobs").update({ status: "stopped" }).eq("id", jobId);
    return Response.json({ stopped: true });
  }
  if (job.status !== "running") {
    return Response.json(
      { error: `Zapytanie nie jest uruchomione (status: ${job.status}). Użyj akcji „start”.` },
      { status: 409 }
    );
  }

  const { data: stagesData, error: sErr } = await db()
    .from("stages")
    .select("*")
    .eq("project_id", job.project_id)
    .order("position");
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
  const enabledStages = (stagesData as StageRow[]).filter((s) => s.enabled);

  // All stages done?
  if (job.current_position >= enabledStages.length) {
    await db()
      .from("jobs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return Response.json({ done: true });
  }

  const stage = enabledStages[job.current_position];

  // Resolve the stage's model
  if (!stage.model_id) {
    const msg = `Etap „${stage.name}” nie ma przypisanego modelu.`;
    await failJob(jobId, msg);
    return Response.json({ error: msg }, { status: 400 });
  }
  const { data: modelData, error: mErr } = await db()
    .from("models")
    .select("*")
    .eq("id", stage.model_id)
    .single();
  if (mErr || !modelData) {
    const msg = `Nie znaleziono modelu dla etapu „${stage.name}”.`;
    await failJob(jobId, msg);
    return Response.json({ error: msg }, { status: 400 });
  }
  const model = modelData as ModelRow;

  // Build variable context: client fields + job variables + previous outputs
  const { data: prevRuns } = await db()
    .from("stage_runs")
    .select("position, output, status")
    .eq("job_id", jobId)
    .eq("status", "success")
    .order("started_at");
  const outputs: Record<number, string> = {};
  for (const r of (prevRuns ?? []) as Pick<StageRunRow, "position" | "output" | "status">[]) {
    outputs[r.position] = r.output ?? "";
  }
  const client = job.projects.clients;
  const ctxMap = buildContext(client, job.variables ?? {}, outputs);
  const { text: renderedPrompt, missing } = interpolate(stage.prompt, ctxMap);

  const stagePosition = job.current_position + 1; // 1-based, matches [OUTPUT_N]
  const { data: attemptData } = await db()
    .from("stage_runs")
    .select("attempt")
    .eq("job_id", jobId)
    .eq("position", stagePosition)
    .order("attempt", { ascending: false })
    .limit(1);
  const attempt = ((attemptData?.[0]?.attempt as number) ?? 0) + 1;

  const { data: runData, error: rErr } = await db()
    .from("stage_runs")
    .insert({
      job_id: jobId,
      stage_id: stage.id,
      position: stagePosition,
      stage_name: stage.name,
      model_snapshot: {
        ...maskModel(model),
        temperature: stage.temperature,
        top_k: stage.top_k,
        top_p: stage.top_p,
        thinking_level: stage.thinking_level,
        max_output_tokens: stage.max_output_tokens,
      },
      status: "running",
      rendered_prompt: renderedPrompt,
      attempt,
    })
    .select()
    .single();
  if (rErr) return Response.json({ error: rErr.message }, { status: 500 });
  const runId = (runData as StageRunRow).id;

  if (missing.length) {
    await logEvent(
      "warn",
      `Etap „${stage.name}”: nieznane zmienne w promptcie: ${missing.join(", ")}`,
      { missing },
      jobId
    );
  }

  try {
    const result = await callLlm(model, {
      prompt: renderedPrompt,
      temperature: stage.temperature,
      topK: stage.top_k,
      topP: stage.top_p,
      thinkingLevel: stage.thinking_level,
      maxOutputTokens: stage.max_output_tokens,
    });

    const cost = calcCost(model, result.inputTokens, result.outputTokens);

    // Optional: publish the stage output as a WordPress draft
    let wpDraftUrl: string | null = null;
    let wpError: string | null = null;
    if (stage.publish_wp_draft && client.wp_enabled) {
      try {
        const title =
          job.name || job.variables?.["SŁOWO_KLUCZOWE"] || `Rise Content Flow ${jobId.slice(0, 8)}`;
        const wp = await publishWpDraft(client, title, result.output);
        wpDraftUrl = wp.url;
      } catch (e) {
        wpError = e instanceof Error ? e.message : String(e);
        await logEvent("warn", `Nie udało się utworzyć draftu WP: ${wpError}`, {}, jobId);
      }
    }

    await db()
      .from("stage_runs")
      .update({
        status: "success",
        request_payload: result.requestPayload,
        response_payload: result.responsePayload,
        output: result.output,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost,
        finished_at: new Date().toISOString(),
        error: wpError ? `Draft WP: ${wpError}` : null,
      })
      .eq("id", runId);

    const isLast = stagePosition >= enabledStages.length;
    await db()
      .from("jobs")
      .update({
        current_position: stagePosition,
        total_input_tokens: (job.total_input_tokens ?? 0) + result.inputTokens,
        total_output_tokens: (job.total_output_tokens ?? 0) + result.outputTokens,
        total_cost: Number(job.total_cost ?? 0) + cost,
        ...(wpDraftUrl ? { wp_draft_url: wpDraftUrl } : {}),
        ...(isLast ? { status: "done", finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", jobId);

    return Response.json({
      done: isLast,
      position: stagePosition,
      totalStages: enabledStages.length,
      stageName: stage.name,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const responsePayload = (e as { responsePayload?: unknown })?.responsePayload ?? null;
    await db()
      .from("stage_runs")
      .update({
        status: "error",
        error: message,
        response_payload: responsePayload,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await failJob(jobId, `Etap ${stagePosition} („${stage.name}”): ${message}`);
    await logEvent("error", `Błąd etapu „${stage.name}”: ${message}`, { stagePosition }, jobId);
    return Response.json({ error: message, position: stagePosition }, { status: 500 });
  }
}

async function failJob(jobId: string, message: string) {
  await db().from("jobs").update({ status: "error", error: message }).eq("id", jobId);
}
