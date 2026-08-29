"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Spinner,
  Textarea,
} from "@/components/ui";
import { api, fmtDate } from "@/lib/fetcher";
import { ClientRow } from "@/lib/types";

interface ClientDetail extends ClientRow {
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    jobs: { count: number }[];
  }>;
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extraJsonText, setExtraJsonText] = useState("{}");
  const [projectName, setProjectName] = useState("");

  async function load() {
    try {
      const data = await api<ClientDetail>(`/api/clients/${id}`);
      setClient(data);
      setExtraJsonText(JSON.stringify(data.extra_json ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set<K extends keyof ClientRow>(key: K, value: ClientRow[K]) {
    setClient((c) => (c ? { ...c, [key]: value } : c));
  }

  async function save() {
    if (!client) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    let extra: Record<string, unknown> = {};
    try {
      extra = extraJsonText.trim() ? JSON.parse(extraJsonText) : {};
    } catch {
      setError("Pole „Dodatkowe dane (JSON)” nie zawiera poprawnego JSON-a.");
      setBusy(false);
      return;
    }
    try {
      await api(`/api/clients/${id}`, {
        method: "PATCH",
        json: {
          name: client.name,
          website: client.website,
          ton_glosu: client.ton_glosu,
          brandbook: client.brandbook,
          wytyczne: client.wytyczne,
          baza_wiedzy: client.baza_wiedzy,
          dane_1: client.dane_1,
          dane_2: client.dane_2,
          extra_json: extra,
          wp_enabled: client.wp_enabled,
          wp_url: client.wp_url,
          wp_username: client.wp_username,
          wp_app_password: client.wp_app_password,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu");
    } finally {
      setBusy(false);
    }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await api<{ id: string }>("/api/projects", {
        method: "POST",
        json: { client_id: id, name: projectName },
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd tworzenia projektu");
      setBusy(false);
    }
  }

  async function deleteClient() {
    if (!confirm(`Usunąć klienta „${client?.name}” wraz z projektami i zapytaniami?`)) return;
    try {
      await api(`/api/clients/${id}`, { method: "DELETE" });
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd usuwania");
    }
  }

  if (!client) {
    return (
      <div className="flex justify-center p-10">
        {error ? <ErrorBox message={error} /> : <Spinner />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-zinc-500 hover:text-indigo-600">← Klienci</Link>
          <h1 className="text-xl font-bold">{client.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" onClick={deleteClient}>Usuń</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Zapisywanie…" : saved ? "Zapisano ✓" : "Zapisz ustawienia"}
          </Button>
        </div>
      </div>
      <ErrorBox message={error} />

      <Card>
        <CardHeader title="Projekty" />
        <div className="p-4">
          <form onSubmit={createProject} className="mb-4 flex items-end gap-3">
            <div className="flex-1">
              <Field label="Nazwa nowego projektu" hint="Nowy projekt otrzyma domyślne prompty (szablon WPiP) — możesz je potem edytować.">
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>+ Utwórz projekt</Button>
          </form>
          {client.projects.length === 0 ? (
            <p className="text-sm text-zinc-500">Brak projektów.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {client.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <Link href={`/projects/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {p.jobs?.[0]?.count ?? 0} zapytań · {fmtDate(p.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Ustawienia klienta (zmienne dostępne w promptach)" />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field label="Nazwa klienta — [KLIENT_NAZWA]">
            <Input value={client.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Adres www — [KLIENT_WWW]">
            <Input value={client.website ?? ""} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="[TON_GŁOSU]">
            <Textarea rows={8} value={client.ton_glosu ?? ""} onChange={(e) => set("ton_glosu", e.target.value)} />
          </Field>
          <Field label="[BRANDBOOK]">
            <Textarea rows={8} value={client.brandbook ?? ""} onChange={(e) => set("brandbook", e.target.value)} />
          </Field>
          <Field label="[WYTYCZNE_OD_KLIENTA]">
            <Textarea rows={8} value={client.wytyczne ?? ""} onChange={(e) => set("wytyczne", e.target.value)} />
          </Field>
          <Field label="[KLIENT_BAZA_WIEDZY]">
            <Textarea rows={8} value={client.baza_wiedzy ?? ""} onChange={(e) => set("baza_wiedzy", e.target.value)} />
          </Field>
          <Field label="[KLIENT_DANE_1]">
            <Textarea rows={5} value={client.dane_1 ?? ""} onChange={(e) => set("dane_1", e.target.value)} />
          </Field>
          <Field label="[KLIENT_DANE_2]">
            <Textarea rows={5} value={client.dane_2 ?? ""} onChange={(e) => set("dane_2", e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field
              label="Dodatkowe dane (JSON)"
              hint="Każdy klucz najwyższego poziomu staje się zmienną w promptach, np. {&quot;INNE_DANE&quot;: &quot;…&quot;} → [INNE_DANE]"
            >
              <Textarea rows={6} value={extraJsonText} onChange={(e) => setExtraJsonText(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="WordPress (opcjonalnie — publikacja draftów)" />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={client.wp_enabled}
              onChange={(e) => set("wp_enabled", e.target.checked)}
            />
            Włącz wrzucanie do WordPressa jako draft (dla etapów z zaznaczoną opcją „Publikuj jako draft WP”)
          </label>
          <Field label="Adres WordPressa" hint="np. https://wpip.pl">
            <Input value={client.wp_url ?? ""} onChange={(e) => set("wp_url", e.target.value)} />
          </Field>
          <Field label="Użytkownik (email)">
            <Input value={client.wp_username ?? ""} onChange={(e) => set("wp_username", e.target.value)} />
          </Field>
          <Field label="Hasło aplikacji (Application Password)">
            <Input
              type="password"
              value={client.wp_app_password ?? ""}
              onChange={(e) => set("wp_app_password", e.target.value)}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
