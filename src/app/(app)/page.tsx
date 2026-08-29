"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, ErrorBox, Field, Input, Spinner } from "@/components/ui";
import { api, fmtDate } from "@/lib/fetcher";

interface ClientListItem {
  id: string;
  name: string;
  website: string | null;
  wp_enabled: boolean;
  created_at: string;
  projects: { count: number }[];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setClients(await api<ClientListItem[]>("/api/clients"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/clients", { method: "POST", json: { name, website } });
      setName("");
      setWebsite("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd zapisu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Klienci</h1>
        <Button onClick={() => setShowForm((v) => !v)}>+ Nowy klient</Button>
      </div>
      <ErrorBox message={error} />

      {showForm && (
        <Card className="p-4">
          <form onSubmit={createClient} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field label="Nazwa klienta">
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
            </div>
            <div className="min-w-56 flex-1">
              <Field label="Adres www">
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>Utwórz</Button>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`Lista klientów ${clients ? `(${clients.length})` : ""}`} />
        {!clients ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : clients.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">
            Brak klientów. Dodaj pierwszego klienta przyciskiem powyżej.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2">Nazwa</th>
                <th className="px-4 py-2">WWW</th>
                <th className="px-4 py-2">Projekty</th>
                <th className="px-4 py-2">Utworzono</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
                  <td className="px-4 py-2">
                    <Link href={`/clients/${c.id}`} className="font-medium text-indigo-600 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{c.website ?? "—"}</td>
                  <td className="px-4 py-2">{c.projects?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-2 text-zinc-500">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
