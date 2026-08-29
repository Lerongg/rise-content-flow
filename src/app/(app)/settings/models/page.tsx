"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, ErrorBox, Field, Input, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { MaskedModel } from "@/lib/maskModel";

const PROVIDERS = [
  ["gemini", "Google Gemini"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["perplexity", "Perplexity"],
  ["openai-compatible", "Inny (zgodny z OpenAI)"],
] as const;

const EMPTY = {
  name: "",
  provider: "gemini",
  model_id: "",
  api_key: "",
  base_url: "",
  input_cost_per_1m: 0,
  output_cost_per_1m: 0,
};

export default function ModelsPage() {
  const [models, setModels] = useState<MaskedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(EMPTY);

  async function load() {
    try {
      setModels(await api<MaskedModel[]>("/api/models"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
  }
  useEffect(() => {
    load();
  }, []);

  function startEdit(m: MaskedModel | null) {
    if (m) {
      setEditing(m.id);
      setForm({
        name: m.name,
        provider: m.provider,
        model_id: m.model_id,
        api_key: "",
        base_url: m.base_url ?? "",
        input_cost_per_1m: m.input_cost_per_1m,
        output_cost_per_1m: m.output_cost_per_1m,
      });
    } else {
      setEditing("new");
      setForm(EMPTY);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") {
        await api("/api/models", { method: "POST", json: form });
      } else {
        const payload = { ...form };
        if (!payload.api_key) delete payload.api_key; // keep the existing key
        await api(`/api/models/${editing}`, { method: "PATCH", json: payload });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MaskedModel) {
    if (!confirm(`Usunąć model „${m.name}”?`)) return;
    try {
      await api(`/api/models/${m.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd usuwania");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Modele</h1>
        <Button onClick={() => startEdit(null)}>+ Dodaj model</Button>
      </div>
      <ErrorBox message={error} />

      {editing && (
        <Card className="p-4">
          <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
            <Field label="Nazwa (widoczna na liście)">
              <Input
                value={String(form.name ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Dostawca">
              <Select
                value={String(form.provider)}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              >
                {PROVIDERS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="ID modelu" hint="np. gemini-2.5-pro, sonar-pro, gpt-5.2">
              <Input
                value={String(form.model_id ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))}
                required
              />
            </Field>
            <Field
              label="Klucz API"
              hint={editing !== "new" ? "Zostaw puste, aby zachować obecny klucz." : undefined}
            >
              <Input
                type="password"
                value={String(form.api_key ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
              />
            </Field>
            <Field label="Base URL (opcjonalnie)" hint="Dla dostawców zgodnych z OpenAI lub własnych endpointów">
              <Input
                value={String(form.base_url ?? "")}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Koszt / 1M tok. ($, input)">
                <Input
                  type="number" step="0.01" min="0"
                  value={Number(form.input_cost_per_1m ?? 0)}
                  onChange={(e) => setForm((f) => ({ ...f, input_cost_per_1m: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Koszt / 1M tok. ($, output)">
                <Input
                  type="number" step="0.01" min="0"
                  value={Number(form.output_cost_per_1m ?? 0)}
                  onChange={(e) => setForm((f) => ({ ...f, output_cost_per_1m: Number(e.target.value) }))}
                />
              </Field>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz"}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Anuluj</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Skonfigurowane modele" />
        {!models ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-2">Nazwa</th>
                  <th className="px-4 py-2">Dostawca</th>
                  <th className="px-4 py-2">ID modelu</th>
                  <th className="px-4 py-2">Klucz API</th>
                  <th className="px-4 py-2">$/1M in</th>
                  <th className="px-4 py-2">$/1M out</th>
                  <th className="px-4 py-2">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-zinc-500">{m.provider}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.model_id}</td>
                    <td className="px-4 py-2">
                      {m.has_api_key ? (
                        <span className="font-mono text-xs text-emerald-600">{m.api_key_preview}</span>
                      ) : (
                        <span className="text-xs text-red-500">brak klucza</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{m.input_cost_per_1m}</td>
                    <td className="px-4 py-2">{m.output_cost_per_1m}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <Button variant="secondary" onClick={() => startEdit(m)}>Edytuj</Button>
                        <Button variant="danger" onClick={() => remove(m)}>✕</Button>
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
  );
}
