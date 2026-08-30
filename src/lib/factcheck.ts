// Wspólna logika etapów Fact-checker / Fixer.

export const FIXER_MARKER = "[PANEL_FIXER]";
export const WEB_SEARCH_MARKER = "[SZUKAJ_W_INTERNECIE]";

export interface FactIssue {
  paragraf: string;
  powod: string;
  poprawka: string;
}

export type FixAction = "ignore" | "ai" | "user";

export interface FixDecision {
  index: number;
  action: FixAction;
  userSuggestion?: string;
}

export function isFixerStage(prompt: string | null | undefined): boolean {
  return Boolean(prompt?.includes(FIXER_MARKER));
}

/**
 * Leniently parses the fact-checker JSON output:
 * strips code fences, finds the outermost object, validates the shape.
 */
export function parseFactIssues(output: string | null | undefined): FactIssue[] | null {
  if (!output) return null;
  let text = output.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { problemy?: unknown };
    if (!Array.isArray(parsed.problemy)) return null;
    return parsed.problemy
      .filter(
        (p): p is FactIssue =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as FactIssue).paragraf === "string" &&
          typeof (p as FactIssue).powod === "string" &&
          typeof (p as FactIssue).poprawka === "string"
      )
      .filter((p) => p.paragraf.trim().length > 0);
  } catch {
    return null;
  }
}
