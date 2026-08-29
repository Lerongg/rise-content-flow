export async function api<T = unknown>(
  url: string,
  options?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = options ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("Brak autoryzacji");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error ?? `Błąd HTTP ${res.status}`
    );
  }
  return data as T;
}

export function fmtCost(v: number | null | undefined): string {
  return `$${Number(v ?? 0).toFixed(4)}`;
}

export function fmtInt(v: number | null | undefined): string {
  return Number(v ?? 0).toLocaleString("pl-PL");
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("pl-PL");
}
