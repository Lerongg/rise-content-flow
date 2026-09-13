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
      await fetch(url, { method: "POST", headers: { cookie } }).catch(() => {});
    })()
  );
}

export function isChainRequest(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get("chain") === "1";
}
