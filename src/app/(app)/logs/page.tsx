"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, ErrorBox, Select, Spinner, StatusBadge } from "@/components/ui";
import { api, fmtDate } from "@/lib/fetcher";
import { LogRow } from "@/lib/types";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [level, setLevel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLogs(await api<LogRow[]>(`/api/logs${level ? `?level=${level}` : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd ładowania");
    }
  }, [level]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Logi</h1>
        <div className="flex items-center gap-2">
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-40">
            <option value="">Wszystkie poziomy</option>
            <option value="error">Błędy</option>
            <option value="warn">Ostrzeżenia</option>
            <option value="info">Informacje</option>
          </Select>
          <Button variant="secondary" onClick={load}>Odśwież</Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Wyczyścić wszystkie logi?")) return;
              await api("/api/logs", { method: "DELETE" });
              await load();
            }}
          >
            Wyczyść
          </Button>
        </div>
      </div>
      <ErrorBox message={error} />

      <Card>
        <CardHeader title="Dziennik zdarzeń (ostatnie 300)" />
        {!logs ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : logs.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Brak wpisów.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-2">Czas</th>
                  <th className="px-4 py-2">Poziom</th>
                  <th className="px-4 py-2">Komunikat</th>
                  <th className="px-4 py-2">Zapytanie</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                    <td className="whitespace-nowrap px-4 py-2 text-zinc-500">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-2"><StatusBadge status={l.level} /></td>
                    <td className="px-4 py-2">{l.message}</td>
                    <td className="px-4 py-2">
                      {l.job_id ? (
                        <Link href={`/jobs/${l.job_id}`} className="text-indigo-600 hover:underline">
                          {l.job_id.slice(0, 8)}
                        </Link>
                      ) : (
                        "—"
                      )}
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
