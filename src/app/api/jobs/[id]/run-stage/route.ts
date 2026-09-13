import { NextRequest } from "next/server";
import { db, logEvent } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildContext, interpolate } from "@/lib/interpolate";
import { isFixerStage, parseFactIssues } from "@/lib/factcheck";
import {
  calcCost,
  callLlm,
  pollOpenAiBackground,
  startOpenAiBackground,
} from "@/lib/providers";
import { publishWpDraft } from "@/lib/wordpress";
import { maskModel } from "@/lib/maskModel";
import { ClientRow, JobRow, ModelRow, StageRow, StageRunRow } from "@/lib/types";
import { isChainRequest, scheduleChainTick } from "@/lib/chain";

// One stage per invocation — keeps each request within serverless limits
// and makes stop/resume natural.
// 300 s = maksimum planu Hobby na Vercelu; na planie Pro można podnieść do 800.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { id: jobId } = await ctx.params;
  // Tryb łańcucha: to wywołanie pochodzi z serwerowej pętli (waitUntil) i po
  // odpowiedzi niekońcowej planuje kolejny tick — workflow biegnie bez przeglądarki.
  const chain = isChainRequest(req);

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
  const stagePosition = job.current_position + 1; // 1-based, matches [OUTPUT_N]

  // Sprzątanie "zombie runs": jeśli poprzednie wywołanie zostało ubite przez limit
  // czasu funkcji (Vercel), run zostaje na zawsze w statusie "running". Oznaczamy
  // takie przebiegi (starsze niż 6 min) jako błąd, żeby zapytanie się nie zacinało.
  const staleCutoff = new Date(Date.now() - 6 * 60_000).toISOString();
  await db()
    .from("stage_runs")
    .update({
      status: "error",
      error:
        "Przerwane — funkcja przekroczyła limit czasu platformy zanim zapisała wynik (zombie run).",
      finished_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("status", "running")
    .is("request_payload->>background_response_id", null)
    .lt("started_at", staleCutoff);
  // Przebiegi "running" na pozycjach, które job już minął (np. duplikat z wyścigu,
  // po którym nowsza próba zakończyła etap) — zamykamy jako zastąpione.
  await db()
    .from("stage_runs")
    .update({
      status: "error",
      error: "Zastąpione — etap został ukończony inną próbą.",
      finished_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("status", "running")
    .lt("position", job.current_position + 1);

  // Outputs of previous stages (latest successful attempt per position)
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

  // Etap typu FIXER: nie wywołuje modelu. Jeśli fact-checker (poprzedni etap) znalazł
  // problemy — job przechodzi w status "review" i czeka na decyzje użytkownika w panelu.
  // Jeśli problemów brak — tekst przechodzi dalej bez zmian.
  if (isFixerStage(stage.prompt)) {
    const fcOutput = outputs[stagePosition - 1];
    const issues = parseFactIssues(fcOutput);
    if (issues === null) {
      const msg = `Etap „${stage.name}”: nie udało się sparsować JSON z wynikami weryfikacji poprzedniego etapu.`;
      await failJob(jobId, msg);
      await logEvent("error", msg, {}, jobId);
      return Response.json({ error: msg }, { status: 500 });
    }
    if (issues.length === 0) {
      const cleanText = outputs[stagePosition - 2] ?? "";
      const isLast = stagePosition >= enabledStages.length;
      await db().from("stage_runs").insert({
        job_id: jobId,
        stage_id: stage.id,
        position: stagePosition,
        stage_name: stage.name,
        status: "success",
        rendered_prompt:
          "(Weryfikator nie znalazł problemów — tekst przechodzi dalej bez zmian.)",
        output: cleanText,
        finished_at: new Date().toISOString(),
      });
      await db()
        .from("jobs")
        .update({
          current_position: stagePosition,
          ...(isLast ? { status: "done", finished_at: new Date().toISOString() } : {}),
        })
        .eq("id", jobId);
      if (chain && !isLast) scheduleChainTick(req, jobId, 1_500);
      return Response.json({
        done: isLast,
        position: stagePosition,
        totalStages: enabledStages.length,
        stageName: stage.name,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
      });
    }
    await db().from("jobs").update({ status: "review" }).eq("id", jobId);
    await logEvent(
      "info",
      `Weryfikator znalazł ${issues.length} problem(y) — zapytanie czeka na decyzje w panelu.`,
      {},
      jobId
    );
    return Response.json({ review: true, issues: issues.length, position: stagePosition });
  }

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
  const client = job.projects.clients;
  const isLastStage = stagePosition >= enabledStages.length;

  // Wspólna finalizacja sukcesu (ścieżka synchroniczna i background)
  async function finalizeSuccess(
    runId: string,
    result: { output: string; inputTokens: number; outputTokens: number; responsePayload: unknown },
    requestPayload?: Record<string, unknown>
  ) {
    const cost = calcCost(model, result.inputTokens, result.outputTokens);

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
        ...(requestPayload ? { request_payload: requestPayload } : {}),
        response_payload: result.responsePayload,
        output: result.output,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost,
        finished_at: new Date().toISOString(),
        error: wpError ? `Draft WP: ${wpError}` : null,
      })
      .eq("id", runId);

    await db()
      .from("jobs")
      .update({
        current_position: stagePosition,
        total_input_tokens: (job.total_input_tokens ?? 0) + result.inputTokens,
        total_output_tokens: (job.total_output_tokens ?? 0) + result.outputTokens,
        total_cost: Number(job.total_cost ?? 0) + cost,
        ...(wpDraftUrl ? { wp_draft_url: wpDraftUrl } : {}),
        ...(isLastStage ? { status: "done", finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", jobId);

    if (chain && !isLastStage) scheduleChainTick(req, jobId, 1_500);

    return Response.json({
      done: isLastStage,
      position: stagePosition,
      totalStages: enabledStages.length,
      stageName: stage.name,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost,
    });
  }

  async function finalizeError(runId: string, message: string, responsePayload: unknown) {
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

  // Czy ktoś już pracuje nad tym etapem? (generacja w tle lub równoległe wywołanie)
  const { data: activeRuns } = await db()
    .from("stage_runs")
    .select("*")
    .eq("job_id", jobId)
    .eq("position", stagePosition)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);
  const activeRun = activeRuns?.[0] as StageRunRow | undefined;
  if (activeRun) {
    const bgId = (activeRun.request_payload as { background_response_id?: string } | null)
      ?.background_response_id;
    const ageMs = Date.now() - new Date(activeRun.started_at).getTime();

    if (bgId && model.provider === "openai") {
      // Generacja w tle: ZAWSZE najpierw odpytaj (wynik czeka u OpenAI do 30 dni),
      // dopiero brak wyniku po 24h traktujemy jako porażkę.
      const poll = await pollOpenAiBackground(model, bgId);
      if (poll.status === "completed") return finalizeSuccess(activeRun.id, poll.result);
      if (poll.status === "failed") {
        return finalizeError(activeRun.id, poll.error, poll.responsePayload);
      }
      if (ageMs > 24 * 60 * 60_000) {
        return finalizeError(
          activeRun.id,
          "Generacja w tle nie zakończyła się w ciągu 24 godzin.",
          null
        );
      }
      if (chain) scheduleChainTick(req, jobId, 15_000);
      return Response.json({
        pending: true,
        position: stagePosition,
        totalStages: enabledStages.length,
        stageName: stage.name,
      });
    }

    // Świeży przebieg bez id generacji w tle: albo inne wywołanie właśnie zleca
    // background (wyścig), albo trwa wywołanie synchroniczne — poczekaj zamiast
    // tworzyć duplikat. Starsze martwe przebiegi sprząta czyściciel powyżej.
    if (ageMs < 6 * 60_000) {
      if (chain) scheduleChainTick(req, jobId, 15_000);
      return Response.json({
        pending: true,
        position: stagePosition,
        totalStages: enabledStages.length,
        stageName: stage.name,
      });
    }
  }

  // Build variable context: client fields + job variables + previous outputs
  const ctxMap = buildContext(client, job.variables ?? {}, outputs);
  ctxMap["OUTPUT_POPRZEDNI"] = outputs[stagePosition - 1] ?? "";
  const { text: renderedPrompt, missing } = interpolate(stage.prompt, ctxMap);

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

  // OpenAI: zleć generację w tle (Responses API, background: true) — limit czasu
  // platformy przestaje obowiązywać; kolejne wywołania run-stage odpytują status.
  if (model.provider === "openai") {
    try {
      const { responseId, requestPayload } = await startOpenAiBackground(model, {
        prompt: renderedPrompt,
        temperature: stage.temperature,
        topK: stage.top_k,
        topP: stage.top_p,
        thinkingLevel: stage.thinking_level,
        maxOutputTokens: stage.max_output_tokens,
      });
      await db()
        .from("stage_runs")
        .update({ request_payload: { ...requestPayload, background_response_id: responseId } })
        .eq("id", runId);
      await logEvent(
        "info",
        `Etap „${stage.name}”: generacja zlecona w tle (OpenAI background, ${responseId})`,
        {},
        jobId
      );
      // po zleceniu ZAWSZE podtrzymaj łańcuch serwerowy — nawet gdy zlecał klient,
      // żeby workflow dokończył się po zamknięciu przeglądarki
      scheduleChainTick(req, jobId, 15_000);
      return Response.json({
        pending: true,
        position: stagePosition,
        totalStages: enabledStages.length,
        stageName: stage.name,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return finalizeError(
        runId,
        message,
        (e as { responsePayload?: unknown })?.responsePayload ?? null
      );
    }
  }

  // Pozostali dostawcy: wywołanie synchroniczne
  try {
    const result = await callLlm(model, {
      prompt: renderedPrompt,
      temperature: stage.temperature,
      topK: stage.top_k,
      topP: stage.top_p,
      thinkingLevel: stage.thinking_level,
      maxOutputTokens: stage.max_output_tokens,
      // poniżej maxDuration (300 s), żeby błąd czasu zapisał się czysto,
      // zanim platforma ubije funkcję
      timeoutMs: 280_000,
    });

    const droppedParams = (result.requestPayload as { pominiete_parametry?: string[] })
      .pominiete_parametry;
    if (droppedParams?.length) {
      await logEvent(
        "warn",
        `Etap „${stage.name}”: model ${model.model_id} nie wspiera części parametrów — pominięto: ${droppedParams.join(", ")}`,
        { dropped: droppedParams },
        jobId
      );
    }

    return finalizeSuccess(runId, result, result.requestPayload);
  } catch (e) {
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "Przekroczono limit czasu etapu (280 s). Wznów zapytanie — jeśli to się powtarza, obniż thinking level tego etapu albo wybierz szybszy model."
        : e instanceof Error
          ? e.message
          : String(e);
    return finalizeError(
      runId,
      message,
      (e as { responsePayload?: unknown })?.responsePayload ?? null
    );
  }
}

async function failJob(jobId: string, message: string) {
  await db().from("jobs").update({ status: "error", error: message }).eq("id", jobId);
}
