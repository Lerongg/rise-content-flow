import { ClientRow } from "./types";

/**
 * Builds the variable context for prompt interpolation.
 * Priority (later wins): client extra_json < client fields < job variables < stage outputs.
 */
export function buildContext(
  client: ClientRow,
  jobVariables: Record<string, string>,
  outputsByPosition: Record<number, string>
): Record<string, string> {
  const ctx: Record<string, string> = {};

  // Client-level extra JSON: every top-level key becomes a variable
  if (client.extra_json && typeof client.extra_json === "object") {
    for (const [k, v] of Object.entries(client.extra_json)) {
      ctx[k] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    }
  }

  // Client-level fields
  ctx["TON_GŁOSU"] = client.ton_glosu ?? "";
  ctx["TON_GLOSU"] = client.ton_glosu ?? "";
  ctx["BRANDBOOK"] = client.brandbook ?? "";
  ctx["WYTYCZNE_OD_KLIENTA"] = client.wytyczne ?? "";
  ctx["KLIENT_BAZA_WIEDZY"] = client.baza_wiedzy ?? "";
  ctx["KLIENT_DANE_1"] = client.dane_1 ?? "";
  ctx["KLIENT_DANE_2"] = client.dane_2 ?? "";
  ctx["KLIENT_NAZWA"] = client.name ?? "";
  ctx["KLIENT_WWW"] = client.website ?? "";

  // Job-level variables (SŁOWO_KLUCZOWE, JĘZYK, CEL_ARTYKUŁU, CTA, BAZA_WIEDZY, DANE_1, DANE_2, custom...)
  for (const [k, v] of Object.entries(jobVariables ?? {})) {
    ctx[k] = v ?? "";
  }

  // Stage outputs: [OUTPUT_1] .. [OUTPUT_N]
  for (const [pos, out] of Object.entries(outputsByPosition)) {
    ctx[`OUTPUT_${pos}`] = out ?? "";
  }

  return ctx;
}

const VAR_RE = /\[([A-ZĄĆĘŁŃÓŚŹŻ0-9_ĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż-]+)\]/g;

/** Replaces [VARIABLE] tokens with context values. Unknown tokens are left untouched. */
export function interpolate(
  template: string,
  ctx: Record<string, string>
): { text: string; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  const text = template.replace(VAR_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) {
      used.push(key);
      return ctx[key];
    }
    missing.push(key);
    return match;
  });
  return { text, used, missing };
}

/** Lists all [VARIABLE] tokens appearing in a template. */
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) found.add(m[1]);
  return [...found];
}
