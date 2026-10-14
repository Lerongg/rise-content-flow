import { waitUntil } from "@vercel/functions";
import { NextRequest } from "next/server";
import { makeToken } from "./auth";
import { db } from "./db";

/**
 * Serwerowy "łańcuch" wykonywania workflow: po zwróceniu odpowiedzi funkcja
 * planuje (waitUntil) kolejne wywołanie run-stage z parametrem ?chain=1.
 * Dzięki temu workflow postępuje bez otwartej przeglądarki — pętla w kliencie
 * jest tylko dodatkowym podglądem. Łańcuch gaśnie na done/error/review/stop.
 */
export function scheduleChainTick(req: NextRequest, jobId: string, delayMs: number) {
  const url = new URL(`/api/jobs/${jobId}/run-stage?chain=1`, req.nextUrl.origin);
  // x-chain-token: wewnętrzna autoryzacja ticków (HMAC) — działa też, gdy wywołanie
  // źródłowe nie miało cookie sesji (np. cron / sweeper).
  const headers = {
    cookie: req.headers.get("cookie") ?? "",
    "x-chain-token": makeToken(),
  };
  waitUntil(
    (async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      // Pojedynczy nieudany fetch nie może zabić całego łańcucha — ponawiamy.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { method: "POST", headers });
          // 2xx = ogniwo wykonane (kolejne zaplanuje samo);
          // 409 = job nie jest w stanie running (stop/review/done) — łańcuch gaśnie celowo;
          // 4xx/5xx inne = spróbuj ponownie.
          if (res.ok || res.status === 409) return;
        } catch {
          // błąd sieciowy — ponów
        }
        await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
      }
    })()
  );
}

export function isChainRequest(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get("chain") === "1";
}

/** Autoryzacja wewnętrznego ticka łańcucha (nagłówek x-chain-token). */
export function isChainAuthorized(req: NextRequest): boolean {
  return req.headers.get("x-chain-token") === makeToken();
}

/**
 * Sweeper: znajduje WSZYSTKIE joby w statusie "running" bez aktywności od >90 s
 * (martwy łańcuch — np. porzucone waitUntil przy kilku jobach naraz) i wskrzesza
 * ich pętle. Wołany przy liście zapytań, w tickach łańcucha i w /api/health —
 * dzięki temu równoległe joby pilnują się nawzajem.
 */
export async function sweepStalledJobs(req: NextRequest, excludeJobId?: string) {
  try {
    const { data: jobs } = await db()
      .from("jobs")
      .select("id")
      .eq("status", "running")
      .limit(20);
    const ids = (jobs ?? []).map((j) => j.id as string).filter((id) => id !== excludeJobId);
    if (!ids.length) return;
    const { data: runs } = await db()
      .from("stage_runs")
      .select("job_id, started_at, finished_at, request_payload")
      .in("job_id", ids)
      .order("started_at", { ascending: false })
      .limit(200);
    const lastByJob = new Map<string, number>();
    for (const r of runs ?? []) {
      const lp = (r.request_payload as { last_poll_at?: string } | null)?.last_poll_at;
      const ts = [r.started_at, r.finished_at, lp]
        .filter(Boolean)
        .map((t) => new Date(t as string).getTime());
      if (ts.length) {
        const m = Math.max(...ts);
        lastByJob.set(r.job_id as string, Math.max(lastByJob.get(r.job_id as string) ?? 0, m));
      }
    }
    for (const id of ids) {
      if (Date.now() - (lastByJob.get(id) ?? 0) > 90_000) {
        scheduleChainTick(req, id, 500);
      }
    }
  } catch {
    // sweeper nigdy nie może wywrócić głównego żądania
  }
}
