import { waitUntil } from "@vercel/functions";
import { NextRequest } from "next/server";

/**
 * Serwerowy "łańcuch" wykonywania workflow: po zwróceniu odpowiedzi funkcja
 * planuje (waitUntil) kolejne wywołanie run-stage z parametrem ?chain=1.
 * Dzięki temu workflow postępuje bez otwartej przeglądarki — pętla w kliencie
 * jest tylko dodatkowym podglądem. Łańcuch gaśnie na done/error/review/stop.
 */
export function scheduleChainTick(req: NextRequest, jobId: string, delayMs: number) {
  const url = new URL(`/api/jobs/${jobId}/run-stage?chain=1`, req.nextUrl.origin);
  const cookie = req.headers.get("cookie") ?? "";
  waitUntil(
    (async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      // Pojedynczy nieudany fetch nie może zabić całego łańcucha — ponawiamy.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { method: "POST", headers: { cookie } });
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
