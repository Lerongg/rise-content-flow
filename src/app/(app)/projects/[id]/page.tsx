"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { api, fmtCost, fmtDate, fmtInt } from "@/lib/fetcher";
import { runJob } from "@/lib/runner";
import { ClientRow, JobRow, ProjectRow, StageRow, VariableDef } from "@/lib/types";
import { MaskedModel } from "@/lib/maskModel";
import { extractVariables } from "@/lib/interpolate";

interface ProjectDetail extends ProjectRow {
  clients: ClientRow;
  stages: StageRow[];
}

type EditableStage = Partial<StageRow> & { name: string; prompt: string };

type Tab = "jobs" | "stages" | "settings";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [models, setModels] = useState<MaskedModel[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [tab, setTab] = useState<Tab>("jobs");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // stage editor state
  const [stages, setStages] = useState<EditableStage[]>([]);
  const [openStage, setOpenStage] = useState<number | null>(null);

  // settings state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<VariableDef[]>([]);

  // new job form
  const [jobVars, setJobVars] = useState<Record<string, string>>({});
  const [showJobForm, setShowJobForm] = useState(false);

  // bulk runner
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const bulkAbort = useRef(false);

  const load = useCallback(async () => {
    try {
      const [p, m, j] = await Promise.all([
        api<ProjectDetail>(`/api/projects/${id}`),
        api<MaskedModel[]>("/api/models"),
        api<JobRow[]>(`/api/jobs?project_id=${id}`),
      ]);
      setProject(p);
      setModels(m);
      setJobs(j);
      setStages(p.stages);
      setName(p.name);
      setDescription(p.description ?? "");
      setVariables(p.variables ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await api<JobRow[]>(`/api/jobs?project_id=${id}`));
    } catch {
      /* transient */
    }
  }, [id]);

  // auto-refresh job list while anything is running
  useEffect(() => {
    if (!jobs.some((j) => j.status === "running") && runningJobs.size === 0) return;
    const t = setInterval(refreshJobs, 4000);
    return () => clearInterval(t);
  }, [jobs, runningJobs, refreshJobs]);

  const promptVariables = useMemo(() => {
    const all = new Set<string>();
    for (const s of stages) for (const v of extractVariables(s.prompt ?? "")) all.add(v);
    return [...all];
  }, [stages]);

  async function saveStages() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<StageRow[]>(`/api/projects/${id}/stages`, {
        method: "PUT",
        json: { stages },
      });
      setStages(updated);
      flashSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu etapów");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${id}`, {
        method: "PATCH",
        json: { name, description, variables },
      });
      flashSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu ustawień");
    } finally {
      setBusy(false);
    }
  }

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function setStage(i: number, patch: Partial<EditableStage>) {
    setStages((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function moveStage(i: number, dir: -1 | 1) {
    setStages((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/jobs", { method: "POST", json: { project_id: id, variables: jobVars } });
      setJobVars({});
      setShowJobForm(false);
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd tworzenia zapytania");
    } finally {
      setBusy(false);
    }
  }

  async function startSingle(jobId: string) {
    setRunningJobs((s) => new Set(s).add(jobId));
    runJob(jobId, () => refreshJobs()).finally(() => {
      setRunningJobs((s) => {
        const next = new Set(s);
        next.delete(jobId);
        return next;
      });
      refreshJobs();
    });
  }

  async function stopJob(jobId: string) {
    try {
      await api(`/api/jobs/${jobId}/control`, { method: "POST", json: { action: "stop" } });
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zatrzymywania");
    }
  }

  async function runAllPending() {
    bulkAbort.current = false;
    const targets = jobs.filter((j) => j.status === "pending" || j.status === "stopped" || j.status === "error");
    for (const j of targets) {
      if (bulkAbort.current) break;
      setRunningJobs((s) => new Set(s).add(j.id));
      try {
        await runJob(j.id, () => refreshJobs());
      } catch {
        /* error already stored on the job */
      } finally {
        setRunningJobs((s) => {
          const next = new Set(s);
          next.delete(j.id);
          return next;
        });
      }
      await refreshJobs();
    }
  }

  if (!project) {
    return (
      <div className="flex justify-center p-10">
        {error ? <ErrorBox message={error} /> : <Spinner />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/clients/${project.client_id}`} className="text-xs text-zinc-500 hover:text-indigo-600">
            ← {project.clients?.name}
          </Link>
          <h1 className="text-xl font-bold">{project.name}</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
          {(
            [
              ["jobs", "Zapytania"],
              ["stages", "Etapy i prompty"],
              ["settings", "Ustawienia"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === key
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox message={error} />

      {tab === "jobs" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Zapytania (ukończone)", `${jobs.length} (${jobs.filter((j) => j.status === "done").length})`],
              ["Tokeny wejściowe", fmtInt(jobs.reduce((s, j) => s + Number(j.total_input_tokens ?? 0), 0))],
              ["Tokeny wyjściowe", fmtInt(jobs.reduce((s, j) => s + Number(j.total_output_tokens ?? 0), 0))],
              ["Koszt projektu", fmtCost(jobs.reduce((s, j) => s + Number(j.total_cost ?? 0), 0))],
            ].map(([label, value]) => (
              <Card key={label as string} className="p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
                <p className="text-lg font-bold">{value}</p>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowJobForm((v) => !v)}>+ Nowe zapytanie</Button>
            <Button variant="success" onClick={runAllPending} disabled={runningJobs.size > 0}>
              ▶ Uruchom wszystkie oczekujące
            </Button>
            {runningJobs.size > 0 && (
              <Button variant="secondary" onClick={() => (bulkAbort.current = true)}>
                Przerwij kolejkę po bieżącym
              </Button>
            )}
          </div>

          {showJobForm && (
            <Card className="p-4">
              <form onSubmit={createJob} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  {(variables.length ? variables : []).map((v) => (
                    <Field
                      key={v.key}
                      label={
                        <>
                          [{v.key}]{v.required && <span className="text-red-500"> *</span>}
                        </>
                      }
                    >
                      <Textarea
                        rows={2}
                        value={jobVars[v.key] ?? ""}
                        onChange={(e) => setJobVars((m) => ({ ...m, [v.key]: e.target.value }))}
                        required={v.required}
                      />
                    </Field>
                  ))}
                </div>
                <Button type="submit" disabled={busy}>Utwórz zapytanie</Button>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader title={`Zapytania (${jobs.length})`} />
            {jobs.length === 0 ? (
              <p className="p-6 text-sm text-zinc-500">Brak zapytań w tym projekcie.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                      <th className="px-4 py-2">Zapytanie</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Etap</th>
                      <th className="px-4 py-2">Tokeny (in/out)</th>
                      <th className="px-4 py-2">Koszt</th>
                      <th className="px-4 py-2">Utworzono</th>
                      <th className="px-4 py-2">Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                        <td className="max-w-64 truncate px-4 py-2">
                          <Link href={`/jobs/${j.id}`} className="font-medium text-indigo-600 hover:underline">
                            {j.name || j.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-4 py-2"><StatusBadge status={j.status} /></td>
                        <td className="px-4 py-2 text-zinc-500">{j.current_position}</td>
                        <td className="px-4 py-2 text-zinc-500">
                          {fmtInt(j.total_input_tokens)} / {fmtInt(j.total_output_tokens)}
                        </td>
                        <td className="px-4 py-2">{fmtCost(j.total_cost)}</td>
                        <td className="px-4 py-2 text-zinc-500">{fmtDate(j.created_at)}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {j.status === "running" || runningJobs.has(j.id) ? (
                              <Button variant="secondary" onClick={() => stopJob(j.id)}>⏹ Stop</Button>
                            ) : (
                              <Button variant="success" onClick={() => startSingle(j.id)}>▶</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "stages" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              Zmienne dostępne w promptach: {promptVariables.map((v) => `[${v}]`).join(", ") || "—"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  setStages((s) => [
                    ...s,
                    { name: `Etap ${s.length + 1}`, prompt: "", enabled: true, publish_wp_draft: false } as EditableStage,
                  ])
                }
              >
                + Dodaj etap
              </Button>
              <Button onClick={saveStages} disabled={busy}>
                {busy ? "Zapisywanie…" : saved ? "Zapisano ✓" : "Zapisz etapy"}
              </Button>
            </div>
          </div>

          {stages.map((s, i) => (
            <Card key={s.id ?? `new-${i}`}>
              <div
                className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3"
                onClick={() => setOpenStage(openStage === i ? null : i)}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {i + 1}
                  </span>
                  <span className={`text-sm font-semibold ${s.enabled === false ? "text-zinc-400 line-through" : ""}`}>
                    {s.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {models.find((m) => m.id === s.model_id)?.name ?? "brak modelu"}
                  </span>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" onClick={() => moveStage(i, -1)} disabled={i === 0}>↑</Button>
                  <Button variant="secondary" onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1}>↓</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Usunąć etap „${s.name}”?`)) {
                        setStages((list) => list.filter((_, idx) => idx !== i));
                      }
                    }}
                  >
                    ✕
                  </Button>
                </div>
              </div>
              {openStage === i && (
                <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Nazwa etapu (agenta)">
                      <Input value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} />
                    </Field>
                    <Field label="Model">
                      <Select
                        value={s.model_id ?? ""}
                        onChange={(e) => setStage(i, { model_id: e.target.value || null })}
                      >
                        <option value="">— wybierz model —</option>
                        {models
                          .filter((m) => m.active)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.model_id})
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Thinking level" hint="np. low / medium / high (jeśli model wspiera)">
                      <Input
                        value={s.thinking_level ?? ""}
                        onChange={(e) => setStage(i, { thinking_level: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Temperature">
                      <Input
                        type="number" step="0.05" min="0" max="2"
                        value={s.temperature ?? ""}
                        onChange={(e) =>
                          setStage(i, { temperature: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Top K">
                      <Input
                        type="number" step="1" min="0"
                        value={s.top_k ?? ""}
                        onChange={(e) => setStage(i, { top_k: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Top P">
                      <Input
                        type="number" step="0.05" min="0" max="1"
                        value={s.top_p ?? ""}
                        onChange={(e) => setStage(i, { top_p: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Limit tokenów wyjścia (opcjonalnie)">
                      <Input
                        type="number" step="1" min="1"
                        value={s.max_output_tokens ?? ""}
                        onChange={(e) =>
                          setStage(i, { max_output_tokens: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.enabled !== false}
                        onChange={(e) => setStage(i, { enabled: e.target.checked })}
                      />
                      Etap włączony
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(s.publish_wp_draft)}
                        onChange={(e) => setStage(i, { publish_wp_draft: e.target.checked })}
                      />
                      Publikuj wynik jako draft WP
                    </label>
                  </div>
                  <Field
                    label="Prompt"
                    hint="Zmienne w nawiasach kwadratowych, np. [SŁOWO_KLUCZOWE], [TON_GŁOSU], [OUTPUT_1]…[OUTPUT_N] (wynik wcześniejszego etapu)."
                  >
                    <Textarea
                      rows={16}
                      value={s.prompt}
                      onChange={(e) => setStage(i, { prompt: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Ustawienia projektu"
              actions={
                <Button onClick={saveSettings} disabled={busy}>
                  {busy ? "Zapisywanie…" : saved ? "Zapisano ✓" : "Zapisz"}
                </Button>
              }
            />
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <Field label="Nazwa projektu">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Opis">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Zmienne zapytań"
              actions={
                <Button
                  variant="secondary"
                  onClick={() => setVariables((v) => [...v, { key: "", label: "", required: false }])}
                >
                  + Dodaj zmienną
                </Button>
              }
            />
            <div className="space-y-2 p-4">
              <p className="text-xs text-zinc-500">
                Te pola pojawią się w formularzu nowego zapytania. Zmienne oznaczone jako wymagane
                muszą być wypełnione przed uruchomieniem workflow.
              </p>
              {variables.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="KLUCZ (np. SŁOWO_KLUCZOWE)"
                    value={v.key}
                    onChange={(e) =>
                      setVariables((list) =>
                        list.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x))
                      )
                    }
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={v.required}
                      onChange={(e) =>
                        setVariables((list) =>
                          list.map((x, idx) => (idx === i ? { ...x, required: e.target.checked } : x))
                        )
                      }
                    />
                    wymagana
                  </label>
                  <Button
                    variant="danger"
                    onClick={() => setVariables((list) => list.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Strefa niebezpieczna" />
            <div className="p-4">
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Usunąć projekt „${project.name}” wraz z zapytaniami?`)) return;
                  await api(`/api/projects/${id}`, { method: "DELETE" });
                  router.push(`/clients/${project.client_id}`);
                }}
              >
                Usuń projekt
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
