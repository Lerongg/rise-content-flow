import { NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { FixDecision, isFixerStage, parseFactIssues } from "@/lib/factcheck";
import { interpolate } from "@/lib/interpolate";
import { calcCost, callLlm } from "@/lib/providers";
import { FIXER_MARKER } from "@/lib/factcheck";
import { JobRow, ModelRow, StageRow, StageRunRow } from "@/lib/types";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Applies the user's decisions for issues found by the fact-checker:
 *  - "ignore": leave the fragment as is
 *  - "ai":     fix the fragment per the fact-checker's suggestion
 *  - "user":   fix the fragment per the user's own suggestion
 * Fixed fragments are spliced into the text (stored as a new attempt of the
 * text-producing stage) and the job is rewound to the fact-checker stage for
 * re-verification. If everything is ignored, the fixer passes the text through.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id: jobId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { decisions?: FixDecision[] };
  if (!Array.isArray(body.decisions)) {
    return Response.json({ error: "Wymagana lista decyzji" }, { status: 400 });
  }

  const { data: jobData, error: jErr } = await db()
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (jErr) return Response.json({ error: jErr.message }, { status: 404 });
  const job = jobData as JobRow;
  if (job.status !== "review") {
    return Response.json(
      { error: `Zapytanie nie czeka na weryfikację (status: ${job.status}).` },
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

  const fixerIdx = job.current_position; // 0-based index of the fixer stage
  const fixerStage = enabledStages[fixerIdx];
  if (!fixerStage || !isFixerStage(fixerStage.prompt)) {
    return Response.json({ error: "Bieżący etap nie jest etapem Fixer." }, { status: 409 });
  }
  const fixerPosition = fixerIdx + 1; // 1-based
  const fcPosition = fixerPosition - 1;
  const textPosition = fixerPosition - 2;
  if (textPosition < 1) {
    return Response.json({ error: "Brak etapu z tekstem przed weryfikatorem." }, { status: 409 });
  }

  // Latest successful outputs per position
  const { data: runsData } = await db()
    .from("stage_runs")
    .select("position, output, status, stage_name, attempt")
    .eq("job_id", jobId)
    .eq("status", "success")
    .order("started_at");
  const runs = (runsData ?? []) as Pick<
    StageRunRow,
    "position" | "output" | "status" | "stage_name" | "attempt"
  >[];
  const latest: Record<number, (typeof runs)[number]> = {};
  for (const r of runs) latest[r.position] = r;

  const issues = parseFactIssues(latest[fcPosition]?.output);
  if (!issues || issues.length === 0) {
    return Response.json({ error: "Brak problemów do rozpatrzenia." }, { status: 409 });
  }
  let text = latest[textPosition]?.output ?? "";
  if (!text) {
    return Response.json({ error: "Brak tekstu do poprawy." }, { status: 409 });
  }

  const toFix = body.decisions.filter(
    (d) => (d.action === "ai" || d.action === "user") && issues[d.index]
  );

  // All ignored -> the fixer passes the current text through and the job moves on
  if (toFix.length === 0) {
    const isLast = fixerPosition >= enabledStages.length;
    await db().from("stage_runs").insert({
      job_id: jobId,
      stage_id: fixerStage.id,
      position: fixerPosition,
      stage_name: fixerStage.name,
      status: "success",
      rendered_prompt: `(Użytkownik zignorował wszystkie ${issues.length} zgłoszenia — tekst bez zmian.)`,
      request_payload: { decyzje: body.decisions },
      output: text,
      finished_at: new Date().toISOString(),
    });
    await db()
      .from("jobs")
      .update({
        current_position: fixerPosition,
        status: isLast ? "done" : "running",
        ...(isLast ? { finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", jobId);
    await logEvent("info", "Fixer: wszystkie zgłoszenia zignorowane, tekst bez zmian.", {}, jobId);
    return Response.json({ done: isLast, reverify: false });
  }

  // Model for fragment fixes = the fixer stage's model
  if (!fixerStage.model_id) {
    return Response.json(
      { error: `Etap „${fixerStage.name}” nie ma przypisanego modelu do poprawek.` },
      { status: 400 }
    );
  }
  const { data: modelData, error: mErr } = await db()
    .from("models")
    .select("*")
    .eq("id", fixerStage.model_id)
    .single();
  if (mErr || !modelData) {
    return Response.json({ error: "Nie znaleziono modelu etapu Fixer." }, { status: 400 });
  }
  const model = modelData as ModelRow;

  const fixTemplate = fixerStage.prompt.split(FIXER_MARKER).join("").trim();
  const applied: Array<Record<string, unknown>> = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;

  for (const d of toFix) {
    const issue = issues[d.index];
    if (!text.includes(issue.paragraf)) {
      applied.push({
        index: d.index,
        status: "nie_znaleziono_fragmentu",
        paragraf: issue.paragraf.slice(0, 200),
      });
      continue;
    }
    const suggestion =
      d.action === "user" && d.userSuggestion?.trim() ? d.userSuggestion.trim() : issue.poprawka;
    const { text: prompt } = interpolate(fixTemplate, {
      FRAGMENT_DO_POPRAWY: issue.paragraf,
      POWOD_BLEDU: issue.powod,
      SUGESTIA_POPRAWKI: suggestion,
      PELNY_TEKST: text,
    });
    try {
      const result = await callLlm(model, {
        prompt,
        temperature: fixerStage.temperature,
        topK: fixerStage.top_k,
        topP: fixerStage.top_p,
        thinkingLevel: fixerStage.thinking_level,
        maxOutputTokens: fixerStage.max_output_tokens,
        timeoutMs: 240_000,
      });
      const fixed = result.output.trim();
      if (!fixed) throw new Error("Model zwrócił pustą poprawkę");
      text = text.replace(issue.paragraf, fixed);
      totalIn += result.inputTokens;
      totalOut += result.outputTokens;
      totalCost += calcCost(model, result.inputTokens, result.outputTokens);
      applied.push({
        index: d.index,
        status: "poprawiono",
        akcja: d.action,
        przed: issue.paragraf.slice(0, 300),
        po: fixed.slice(0, 300),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applied.push({ index: d.index, status: "blad", error: msg });
      await logEvent("error", `Fixer: błąd poprawy fragmentu #${d.index}: ${msg}`, {}, jobId);
    }
  }

  const fixedCount = applied.filter((a) => a.status === "poprawiono").length;

  // Store the corrected text as a new attempt of the text-producing stage,
  // so [OUTPUT_N]/[OUTPUT_POPRZEDNI] resolve to the fixed version everywhere.
  const prevTextRun = latest[textPosition];
  await db().from("stage_runs").insert({
    job_id: jobId,
    position: textPosition,
    stage_name: `${prevTextRun?.stage_name ?? "Tekst"} (poprawki Fixera)`,
    status: "success",
    rendered_prompt: `(Fixer: zastosowano ${fixedCount} poprawek na ${issues.length} zgłoszeń.)`,
    request_payload: { decyzje: body.decisions, poprawki: applied },
    output: text,
    input_tokens: totalIn,
    output_tokens: totalOut,
    cost: totalCost,
    attempt: (prevTextRun?.attempt ?? 1) + 1,
    finished_at: new Date().toISOString(),
  });

  // Rewind to the fact-checker so the corrected text is re-verified
  await db()
    .from("jobs")
    .update({
      current_position: fcPosition - 1,
      status: "running",
      total_input_tokens: (job.total_input_tokens ?? 0) + totalIn,
      total_output_tokens: (job.total_output_tokens ?? 0) + totalOut,
      total_cost: Number(job.total_cost ?? 0) + totalCost,
    })
    .eq("id", jobId);

  await logEvent(
    "info",
    `Fixer: zastosowano ${fixedCount}/${toFix.length} poprawek — tekst wraca do weryfikatora.`,
    { poprawki: applied },
    jobId
  );
  return Response.json({ reverify: true, fixed: fixedCount, applied });
}
