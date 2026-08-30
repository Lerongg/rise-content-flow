// Zgodność parametrów per model/dostawca — na podstawie oficjalnej dokumentacji (08.2026).
// OpenAI: modele reasoningowe (gpt-5*, o*) wspierają temperature/top_p WYŁĄCZNIE przy
//   reasoning_effort = "none"; wartości reasoning_effort (gpt-5.6): none|low|medium|high|xhigh|max.
// Gemini 3.x: thinkingLevel (zakres zależny od modelu); Gemini 2.5: thinkingBudget (liczbowy).
// Anthropic: przy włączonym extended thinking temperature/top_p/top_k są zabronione.

export interface ModelCaps {
  /** Czy model przyjmuje temperature (bezwarunkowo). */
  temperature: boolean;
  /** temperature/top_p dozwolone tylko, gdy thinking level == "none" (modele reasoningowe OpenAI). */
  samplingOnlyWithThinkingNone: boolean;
  topK: boolean;
  topP: boolean;
  /** Dozwolone wartości poziomu thinking (pusta lista = model nie ma takiego parametru). */
  thinkingLevels: string[];
  /** Domyślny poziom thinking (informacyjnie). */
  thinkingDefault: string | null;
  note: string;
}

const OPENAI_REASONING = /^(gpt-5|o[134])/;
const GPT56 = /^gpt-5\.6/;

export function getModelCaps(provider: string, modelId: string): ModelCaps {
  if (provider === "openai" && OPENAI_REASONING.test(modelId)) {
    return {
      temperature: false,
      samplingOnlyWithThinkingNone: true,
      topK: false,
      topP: false,
      thinkingLevels: GPT56.test(modelId)
        ? ["none", "low", "medium", "high", "xhigh", "max"]
        : ["none", "low", "medium", "high"],
      thinkingDefault: "medium",
      note:
        "Model reasoningowy OpenAI: temperature/top_p działają tylko przy poziomie thinking „none”; top_k niedostępny.",
    };
  }
  if (provider === "openai" || provider === "openai-compatible") {
    return {
      temperature: true,
      samplingOnlyWithThinkingNone: false,
      topK: false,
      topP: true,
      thinkingLevels: [],
      thinkingDefault: null,
      note: "Klasyczny model OpenAI-compatible: temperature i top_p; top_k niedostępny.",
    };
  }
  if (provider === "perplexity") {
    const isReasoning = /deep-research|reasoning/.test(modelId);
    return {
      temperature: true,
      samplingOnlyWithThinkingNone: false,
      topK: false,
      topP: true,
      thinkingLevels: isReasoning ? ["low", "medium", "high"] : [],
      thinkingDefault: isReasoning ? "medium" : null,
      note: "Perplexity: temperature i top_p; reasoning_effort tylko dla modeli reasoning/deep-research. Uwaga: dolicza opłaty per request.",
    };
  }
  if (provider === "gemini") {
    let levels: string[] = [];
    let def: string | null = null;
    let thinkingParam = "";
    if (/^gemini-3\.5-flash$|^gemini-3\.6|^gemini-3-flash/.test(modelId)) {
      levels = ["minimal", "low", "medium", "high"];
      def = "medium";
      thinkingParam = "thinkingLevel";
    } else if (/^gemini-3\.1-pro|^gemini-3\.7/.test(modelId)) {
      levels = ["low", "medium", "high"];
      def = "medium";
      thinkingParam = "thinkingLevel";
    } else if (/^gemini-3\.1-flash/.test(modelId)) {
      levels = ["minimal", "low", "medium", "high"];
      def = "medium";
      thinkingParam = "thinkingLevel";
    } else if (/^gemini-3-pro/.test(modelId)) {
      levels = ["low", "high"];
      def = "high";
      thinkingParam = "thinkingLevel";
    } else if (/^gemini-2\.5/.test(modelId)) {
      levels = ["low", "medium", "high"];
      def = null;
      thinkingParam = "thinkingBudget";
    }
    return {
      temperature: true,
      samplingOnlyWithThinkingNone: false,
      topK: true,
      topP: true,
      thinkingLevels: levels,
      thinkingDefault: def,
      note: thinkingParam === "thinkingBudget"
        ? "Gemini 2.5: poziom thinking mapowany na thinkingBudget (low=1024, medium=8192, high=24576). Dla Gemini 3.x Google zaleca zostawić temperature domyślne (1.0)."
        : "Gemini 3.x: thinkingLevel. Google zaleca nie zmieniać temperature (domyślnie 1.0).",
    };
  }
  if (provider === "anthropic") {
    return {
      temperature: true,
      samplingOnlyWithThinkingNone: false,
      topK: true,
      topP: true,
      thinkingLevels: ["low", "medium", "high"],
      thinkingDefault: null,
      note: "Anthropic: przy włączonym thinking (low/medium/high → budget_tokens) temperature/top_p/top_k są pomijane (wymóg API).",
    };
  }
  return {
    temperature: true,
    samplingOnlyWithThinkingNone: false,
    topK: true,
    topP: true,
    thinkingLevels: [],
    thinkingDefault: null,
    note: "",
  };
}

export interface SanitizedParams {
  temperature: number | null;
  topK: number | null;
  topP: number | null;
  thinkingLevel: string | null;
  /** Parametry usunięte, bo model ich nie wspiera (do logu i podglądu requestu). */
  dropped: string[];
}

/** Przycina parametry etapu do tego, co dany model faktycznie przyjmuje. */
export function sanitizeParams(
  provider: string,
  modelId: string,
  p: {
    temperature?: number | null;
    topK?: number | null;
    topP?: number | null;
    thinkingLevel?: string | null;
  }
): SanitizedParams {
  const caps = getModelCaps(provider, modelId);
  const dropped: string[] = [];
  let temperature = p.temperature ?? null;
  let topK = p.topK ?? null;
  let topP = p.topP ?? null;
  let thinkingLevel = p.thinkingLevel?.trim().toLowerCase() || null;

  if (thinkingLevel && caps.thinkingLevels.length === 0) {
    dropped.push(`thinking_level=${thinkingLevel} (model nie wspiera)`);
    thinkingLevel = null;
  }
  if (thinkingLevel && caps.thinkingLevels.length && !caps.thinkingLevels.includes(thinkingLevel)) {
    dropped.push(
      `thinking_level=${thinkingLevel} (dozwolone: ${caps.thinkingLevels.join("/")})`
    );
    thinkingLevel = null;
  }

  const samplingAllowed = caps.samplingOnlyWithThinkingNone
    ? thinkingLevel === "none"
    : true;

  if (temperature != null && (!caps.temperature || !samplingAllowed) ) {
    if (!(caps.samplingOnlyWithThinkingNone && thinkingLevel === "none")) {
      dropped.push(`temperature=${temperature}`);
      temperature = null;
    }
  }
  if (topP != null && (!caps.topP || !samplingAllowed)) {
    dropped.push(`top_p=${topP}`);
    topP = null;
  }
  if (topK != null && !caps.topK) {
    dropped.push(`top_k=${topK}`);
    topK = null;
  }

  // Anthropic: thinking wyklucza sampling
  if (provider === "anthropic" && thinkingLevel) {
    if (temperature != null) { dropped.push(`temperature=${temperature} (thinking włączony)`); temperature = null; }
    if (topP != null) { dropped.push(`top_p=${topP} (thinking włączony)`); topP = null; }
    if (topK != null) { dropped.push(`top_k=${topK} (thinking włączony)`); topK = null; }
  }

  return { temperature, topK, topP, thinkingLevel, dropped };
}
