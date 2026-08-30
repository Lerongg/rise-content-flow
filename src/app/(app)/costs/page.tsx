"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, ErrorBox, Spinner } from "@/components/ui";
import { api, fmtCost, fmtInt } from "@/lib/fetcher";

interface ProjectCost {
  project_id: string;
  project_name: string;
  client_id: string;
  client_name: string;
  jobs: number;
  jobs_done: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

interface ClientCost {
  client_id: string;
  client_name: string;
  jobs: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

interface CostsData {
  perProject: ProjectCost[];
  perClient: ClientCost[];
  total: { jobs: number; input_tokens: number; output_tokens: number; cost: number };
}

export default function CostsPage() {
  const [data, setData] = useState<CostsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CostsData>("/api/costs")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Błąd ładowania"));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Koszty</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Zapytania łącznie", fmtInt(data.total.jobs)],
          ["Tokeny wejściowe", fmtInt(data.total.input_tokens)],
          ["Tokeny wyjściowe", fmtInt(data.total.output_tokens)],
          ["Koszt łączny", fmtCost(data.total.cost)],
        ].map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="text-lg font-bold">{value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Koszty per klient" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2">Klient</th>
                <th className="px-4 py-2">Zapytania</th>
                <th className="px-4 py-2">Tokeny (in/out)</th>
                <th className="px-4 py-2">Koszt</th>
              </tr>
            </thead>
            <tbody>
              {data.perClient.map((c) => (
                <tr key={c.client_id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="px-4 py-2">
                    <Link href={`/clients/${c.client_id}`} className="font-medium text-indigo-600 hover:underline">
                      {c.client_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{fmtInt(c.jobs)}</td>
                  <td className="px-4 py-2 text-zinc-500">
                    {fmtInt(c.input_tokens)} / {fmtInt(c.output_tokens)}
                  </td>
                  <td className="px-4 py-2 font-semibold">{fmtCost(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Koszty per projekt" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2">Projekt</th>
                <th className="px-4 py-2">Klient</th>
                <th className="px-4 py-2">Zapytania (ukończone)</th>
                <th className="px-4 py-2">Tokeny (in/out)</th>
                <th className="px-4 py-2">Koszt</th>
              </tr>
            </thead>
            <tbody>
              {data.perProject.map((p) => (
                <tr key={p.project_id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="px-4 py-2">
                    <Link href={`/projects/${p.project_id}`} className="font-medium text-indigo-600 hover:underline">
                      {p.project_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{p.client_name}</td>
                  <td className="px-4 py-2">
                    {fmtInt(p.jobs)} ({fmtInt(p.jobs_done)})
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {fmtInt(p.input_tokens)} / {fmtInt(p.output_tokens)}
                  </td>
                  <td className="px-4 py-2 font-semibold">{fmtCost(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-zinc-500">
        Koszt pojedynczego zapytania znajdziesz na liście zapytań projektu, a rozbicie na etapy —
        na stronie zapytania. Kwoty liczone są z cen modeli (Ustawienia → Modele) na podstawie
        rzeczywistego zużycia tokenów raportowanego przez API.
      </p>
    </div>
  );
}
