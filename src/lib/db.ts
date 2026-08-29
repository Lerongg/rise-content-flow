import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Server-side Supabase client using the service-role key (never expose to the browser). */
export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Brak konfiguracji Supabase: ustaw zmienne środowiskowe SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export async function logEvent(
  level: "error" | "warn" | "info",
  message: string,
  details?: Record<string, unknown>,
  jobId?: string | null
) {
  try {
    await db()
      .from("logs")
      .insert({ level, message, details: details ?? null, job_id: jobId ?? null });
  } catch {
    // logging must never break the main flow
  }
}
