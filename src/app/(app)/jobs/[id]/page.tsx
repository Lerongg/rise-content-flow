"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Spinner,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { api, fmtCost, fmtDate, fmtInt } from "@/lib/fetcher";
import { runJob } from "@/lib/runner";
import { copyRichText, outputToHtml } from "@/lib/richtext";
import { FactIssue, FixAction, parseFactIssues } from "@/lib/factcheck";
import { JobRow, StageRow, StageRunRow, VariableDef } from "@/lib/types";

interface JobDetail extends JobRow {
  projects: {
    id: string;
    name: string;
    client_id: string;
    variables: VariableDef[];
    clients: { id: string; name: string };
  };
  runs: StageRunRow[];
  stages: (StageRow & { models: { name: string; provider: string; model_id: string } | null })[];
}

function ReviewPanel({
  issues,
  onSubmit,
  busy,
}: {
  issues: FactIssue[];
  onSubmit: (decisions: Array<{ index: number; action: FixAction; userSuggestion?: string }>) => void;
  busy: boolean;
}) {
  const [actions, setActions] = useState<Record<number, FixAction>>({});
  const [suggestions, setSuggestions] = useState<Record<number, string>>({});

  return (
    <Card className="border-purple-300 dark:border-purple-800">
      <CardHeader
        title={`🔎 Weryfikacja faktów — ${issues.length} zgłoszeń do decyzji`}
        actions={
          <Button
            disabled={busy}
            onClick={() =>
              onSubmit(
                issues.map((_, i) => ({
                  index: i,
                  action: actions[i] ?? "ignore",
                  userSuggestion: suggestions[i],
                }))
              )
            }
          >
            {busy ? "Stosowanie…" : "Zastosuj decyzje"}
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <p className="text-xs text-zinc-500">
          Fact-checker znalazł poniższe problemy. Zdecyduj dla każdego: zignoruj, napraw wedle
          sugestii AI albo podaj własną poprawkę. Po zastosowaniu poprawek tekst wróci do
          weryfikatora w celu ponownego sprawdzenia.
        </p>
        {issues.map((issue, i) => {
          const action = actions[i] ?? "ignore";
          return (
            <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500">Fragment z problemem:</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-950">
                {issue.paragraf}
              </pre>
              <p className="text-sm">
                <span className="font-semibold text-red-600">Dlaczego to błąd:</span> {issue.powod}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-emerald-600">Sugestia AI:</span> {issue.poprawka}
              </p>
              <div className="flex flex-wrap gap-4 pt-1 text-sm">
                {(
                  [
                    ["ignore", "Zignoruj"],
                    ["ai", "Napraw wedle sugestii AI"],
                    ["user", "Popraw wedle własnej sugestii"],
                  ] as [FixAction, string][]
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`issue-${i}`}
                      checked={action === value}
                      onChange={() => setActions((a) => ({ ...a, [i]: value }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {action === "user" && (
                <Textarea
                  rows={3}
                  placeholder="Twoja wytyczna / poprawka — AI przepisze fragment zgodnie z nią"
                  value={suggestions[i] ?? ""}
                  onChange={(e) => setSuggestions((s) => ({ ...s, [i]: e.target.value }))}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FinalOutputCard({ runs }: { runs: StageRunRow[] }) {
  const [copied, setCopied] = useState<"rich" | "raw" | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const successes = runs.filter((r) => r.status === "success" && r.output);
  const last = successes[successes.length - 1];
  if (!last?.output) return null;
  const output = last.output;

  async function copy(kind: "rich" | "raw") {
    try {
      if (kind === "rich") await copyRichText(outputToHtml(output), output);
      else await navigator.clipboard.writeText(output);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      alert("Nie udało się skopiować do schowka.");
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Wynik końcowy (etap ${last.position} — ${last.stage_name})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Ukryj podgląd" : "Pokaż podgląd"}
            </Button>
            <Button variant="secondary" onClick={() => copy("raw")}>
              {copied === "raw" ? "Skopiowano ✓" : "Kopiuj źródło"}
            </Button>
            <Button onClick={() => copy("rich")}>
              {copied === "rich" ? "Skopiowano ✓" : "📋 Kopiuj do Google Docs"}
            </Button>
          </div>
        }
      />
      {showPreview && (
        <div
          className="max-h-[32rem] overflow-auto px-6 py-4 text-sm leading-relaxed
            [&_h1]:mb-3 [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-bold
            [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold
            [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold
            [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6
            [&_li]:mb-1 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-300 [&_blockquote]:pl-3 [&_blockquote]:italic
            [&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse
            [&_td]:border [&_td]:border-zinc-300 [&_td]:px-2 [&_td]:py-1 dark:[&_td]:border-zinc-700
            [&_th]:border [&_th]:border-zinc-300 [&_th]:bg-zinc-100 [&_th]:px-2 [&_th]:py-1 dark:[&_th]:border-zinc-700 dark:[&_th]:bg-zinc-800"
          dangerouslySetInnerHTML={{ __html: outputToHtml(output) }}
        />
      )}
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-900">
        „Kopiuj do Google Docs" wkłada do schowka tekst z formatowaniem (nagłówki, listy, tabele)
        — wklej w Google Docs przez zwykłe Ctrl+V. „Kopiuj źródło" kopiuje surowy Markdown/HTML.
      </p>
    </Card>
  );
}

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  if (data == null) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1 text-xs font-semibold text-indigo-600 hover:underline"
      >
        {open ? "▼" : "▶"} {title} ({fmtInt(text.length)} znaków)
      </button>
      {open && (
        <div className="relative">
          <button
            className="absolute right-2 top-2 rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-medium hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            onClick={() => navigator.clipboard.writeText(text)}
          >
            Kopiuj
          </button>
          <pre className="max-h-96 overflow-auto rounded-lg bg-zinc-100 p-3 text-[11px] leading-relaxed dark:bg-zinc-950">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editVars, setEditVars] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const runnerActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api<JobDetail>(`/api/jobs/${id}`);
      setJob(data);
      if (!editVars) setVars(data.variables ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editVars]);

  useEffect(() => {
    load();
  }, [load]);

  // auto-refresh while running
  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [job?.status, load]);

  async function start() {
    if (runnerActive.current) return;
    runnerActive.current = true;
    setError(null);
    try {
      await runJob(id, () => load());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd uruchamiania");
    } finally {
      runnerActive.current = false;
      await load();
    }
  }

  async function control(action: "stop" | "reset") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/jobs/${id}/control`, { method: "POST", json: { action } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd akcji");
    } finally {
      setBusy(false);
    }
  }

  async function saveVars() {
    setBusy(true);
    try {
      await api(`/api/jobs/${id}`, { method: "PATCH", json: { variables: vars } });
      setEditVars(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu zmiennych");
    } finally {
      setBusy(false);
    }
  }

  if (!job) {
    return (
      <div className="flex justify-center p-10">
        {error ? <ErrorBox message={error} /> : <Spinner />}
      </div>
    );
  }

  const enabledStages = job.stages.filter((s) => s.enabled);
  const runsByPosition = new Map<number, StageRunRow[]>();
  for (const r of job.runs) {
    const list = runsByPosition.get(r.position) ?? [];
    list.push(r);
    runsByPosition.set(r.position, list);
  }
  const isRunning = job.status === "running";
  const canResume =
    (job.status === "stopped" || job.status === "error") && job.current_position > 0;

  // Fixer review: issues come from the fact-checker run (1-based position = current_position)
  const reviewIssues =
    job.status === "review"
      ? parseFactIssues(
          (runsByPosition.get(job.current_position) ?? []).slice(-1)[0]?.output
        )
      : null;

  async function submitDecisions(
    decisions: Array<{ index: number; action: FixAction; userSuggestion?: string }>
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ reverify?: boolean; done?: boolean }>(`/api/jobs/${id}/fix`, {
        method: "POST",
        json: { decisions },
      });
      await load();
      if (!res.done) void start(); // kontynuuj workflow (ponowna weryfikacja / dalsze etapy)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd stosowania poprawek");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/projects/${job.projects.id}`}
            className="text-xs text-zinc-500 hover:text-indigo-600"
          >
            ← {job.projects.clients?.name} / {job.projects.name}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="max-w-xl truncate text-xl font-bold">{job.name || `Zapytanie ${id.slice(0, 8)}`}</h1>
            <StatusBadge status={job.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isRunning ? (
            <Button variant="secondary" onClick={() => control("stop")} disabled={busy}>
              ⏹ Zatrzymaj
            </Button>
          ) : (
            <>
              <Button variant="success" onClick={start} disabled={busy}>
                {canResume
                  ? `▶ Wznów od etapu ${job.current_position + 1}`
                  : job.status === "done"
                    ? "▶ Uruchom ponownie (od bieżącej pozycji)"
                    : "▶ Uruchom"}
              </Button>
              <Button variant="secondary" onClick={() => control("reset")} disabled={busy}>
                ↺ Od początku (reset)
              </Button>
            </>
          )}
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Usunąć to zapytanie?")) return;
              await api(`/api/jobs/${id}`, { method: "DELETE" });
              router.push(`/projects/${job.projects.id}`);
            }}
          >
            Usuń
          </Button>
        </div>
      </div>

      <ErrorBox message={error} />
      {job.error && <ErrorBox message={`Błąd workflow: ${job.error}`} />}

      {job.status === "review" && reviewIssues && reviewIssues.length > 0 && (
        <ReviewPanel issues={reviewIssues} busy={busy} onSubmit={submitDecisions} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Postęp", `${job.current_position} / ${enabledStages.length} etapów`],
          ["Tokeny wejściowe", fmtInt(job.total_input_tokens)],
          ["Tokeny wyjściowe", fmtInt(job.total_output_tokens)],
          ["Koszt łączny", fmtCost(job.total_cost)],
        ].map(([label, value]) => (
          <Card key={label as string} className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="text-lg font-bold">{value}</p>
          </Card>
        ))}
      </div>

      {job.wp_draft_url && (
        <Card className="p-3 text-sm">
          Draft WordPress:{" "}
          <a href={job.wp_draft_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
            {job.wp_draft_url}
          </a>
        </Card>
      )}

      <FinalOutputCard runs={job.runs} />

      <Card>
        <CardHeader
          title="Zmienne zapytania"
          actions={
            editVars ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setEditVars(false); setVars(job.variables ?? {}); }}>
                  Anuluj
                </Button>
                <Button onClick={saveVars} disabled={busy}>Zapisz</Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setEditVars(true)} disabled={isRunning}>
                Edytuj
              </Button>
            )
          }
        />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {(job.projects.variables ?? []).map((v) => (
            <Field
              key={v.key}
              label={
                <>
                  [{v.key}]{v.required && <span className="text-red-500"> *</span>}
                </>
              }
            >
              {editVars ? (
                <Textarea
                  rows={3}
                  value={vars[v.key] ?? ""}
                  onChange={(e) => setVars((m) => ({ ...m, [v.key]: e.target.value }))}
                />
              ) : (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-2 text-xs dark:bg-zinc-950">
                  {job.variables?.[v.key] || "—"}
                </pre>
              )}
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Etapy workflow" />
        <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {enabledStages.map((stage, idx) => {
            const position = idx + 1;
            const runs = runsByPosition.get(position) ?? [];
            const lastRun = runs[runs.length - 1];
            const isCurrent = isRunning && job.current_position === idx;
            return (
              <StageSection
                key={stage.id}
                position={position}
                stage={stage}
                runs={runs}
                lastRun={lastRun}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>
      </Card>

      <p className="text-xs text-zinc-500">
        Utworzono: {fmtDate(job.created_at)} · Start: {fmtDate(job.started_at)} · Koniec: {fmtDate(job.finished_at)}
      </p>
    </div>
  );
}

function StageSection({
  position,
  stage,
  runs,
  lastRun,
  isCurrent,
}: {
  position: number;
  stage: StageRow & { models: { name: string; provider: string; model_id: string } | null };
  runs: StageRunRow[];
  lastRun: StageRunRow | undefined;
  isCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAttempts, setShowAttempts] = useState(false);
  const run = lastRun;

  return (
    <div>
      <button
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {position}
          </span>
          <span className="text-sm font-semibold">{stage.name}</span>
          {isCurrent && <Spinner />}
          {run && <StatusBadge status={run.status} />}
          {run && run.attempt > 1 && (
            <span className="text-[11px] text-zinc-500">próba {run.attempt}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{stage.models?.name ?? "brak modelu"}</span>
          {run && run.status !== "running" && (
            <span>
              {fmtInt(run.input_tokens)} / {fmtInt(run.output_tokens)} tok · {fmtCost(run.cost)}
            </span>
          )}
          <span>{open ? "▼" : "▶"}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-900 dark:bg-zinc-950/50">
          {!run ? (
            <p className="text-sm text-zinc-500">Ten etap nie był jeszcze wykonywany.</p>
          ) : (
            <>
              {run.error && <ErrorBox message={run.error} />}
              <div className="text-xs text-zinc-500">
                Start: {fmtDate(run.started_at)} · Koniec: {fmtDate(run.finished_at)}
              </div>
              <JsonBlock title="Wysłany prompt (po podstawieniu zmiennych)" data={run.rendered_prompt} />
              <JsonBlock title="Pełne zapytanie do API (request)" data={run.request_payload} />
              <JsonBlock title="Pełna odpowiedź API (response)" data={run.response_payload} />
              <JsonBlock title="Wynik etapu (output)" data={run.output} />
              {runs.length > 1 && (
                <div>
                  <button
                    onClick={() => setShowAttempts((v) => !v)}
                    className="text-xs font-semibold text-zinc-500 hover:underline"
                  >
                    {showAttempts ? "▼" : "▶"} Poprzednie próby ({runs.length - 1})
                  </button>
                  {showAttempts &&
                    runs.slice(0, -1).map((r) => (
                      <div key={r.id} className="mt-2 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <StatusBadge status={r.status} />
                          próba {r.attempt} · {fmtDate(r.started_at)}
                        </div>
                        {r.error && <ErrorBox message={r.error} />}
                        <JsonBlock title="Prompt" data={r.rendered_prompt} />
                        <JsonBlock title="Request" data={r.request_payload} />
                        <JsonBlock title="Response" data={r.response_payload} />
                        <JsonBlock title="Output" data={r.output} />
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
