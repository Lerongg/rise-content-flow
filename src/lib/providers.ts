import { ModelRow } from "./types";

export interface LlmCallOptions {
  prompt: string;
  temperature?: number | null;
  topK?: number | null;
  topP?: number | null;
  thinkingLevel?: string | null;
  maxOutputTokens?: number | null;
  timeoutMs?: number;
}

export interface LlmResult {
  output: string;
  inputTokens: number;
  outputTokens: number;
  /** Full request body as sent to the provider (API key redacted). */
  requestPayload: Record<string, unknown>;
  /** Full raw JSON response from the provider. */
  responsePayload: unknown;
}

const DEFAULT_TIMEOUT_MS = 750_000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function doFetch(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        `Provider HTTP ${res.status}: ${text.slice(0, 2000)}`
      ) as Error & { responsePayload?: unknown };
      err.responsePayload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function callLlm(model: ModelRow, opts: LlmCallOptions): Promise<LlmResult> {
  if (!model.api_key) {
    throw new Error(
      `Model "${model.name}" nie ma ustawionego klucza API. Uzupełnij go w Ustawienia → Modele.`
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  switch (model.provider) {
    case "gemini":
      return callGemini(model, opts, timeoutMs);
    case "anthropic":
      return callAnthropic(model, opts, timeoutMs);
    case "openai":
    case "perplexity":
    case "openai-compatible":
      return callOpenAiCompatible(model, opts, timeoutMs);
    default:
      throw new Error(`Nieznany dostawca modelu: ${model.provider}`);
  }
}

async function callGemini(
  model: ModelRow,
  opts: LlmCallOptions,
  timeoutMs: number
): Promise<LlmResult> {
  const base = model.base_url?.replace(/\/+$/, "") || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${model.model_id}:generateContent`;

  const generationConfig: Record<string, unknown> = {};
  if (opts.temperature != null) generationConfig.temperature = opts.temperature;
  if (opts.topK != null) generationConfig.topK = opts.topK;
  if (opts.topP != null) generationConfig.topP = opts.topP;
  if (opts.maxOutputTokens != null) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: opts.thinkingLevel.toUpperCase() };
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };

  const json = (await doFetch(url, { "x-goog-api-key": model.api_key! }, body, timeoutMs)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const output = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  const usage = json.usageMetadata ?? {};

  return {
    output,
    inputTokens: num(usage.promptTokenCount),
    outputTokens: num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount),
    requestPayload: { url, method: "POST", body },
    responsePayload: json,
  };
}

async function callOpenAiCompatible(
  model: ModelRow,
  opts: LlmCallOptions,
  timeoutMs: number
): Promise<LlmResult> {
  const defaultBase =
    model.provider === "perplexity" ? "https://api.perplexity.ai" : "https://api.openai.com/v1";
  const base = (model.base_url?.replace(/\/+$/, "") || defaultBase).replace(/\/chat\/completions$/, "");
  const url = `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.model_id,
    messages: [{ role: "user", content: opts.prompt }],
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.topP != null) body.top_p = opts.topP;
  if (opts.maxOutputTokens != null) body.max_tokens = opts.maxOutputTokens;
  if (opts.thinkingLevel && model.provider === "openai") {
    body.reasoning_effort = opts.thinkingLevel.toLowerCase();
  }

  const json = (await doFetch(
    url,
    { authorization: `Bearer ${model.api_key}` },
    body,
    timeoutMs
  )) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    output: json.choices?.[0]?.message?.content ?? "",
    inputTokens: num(json.usage?.prompt_tokens),
    outputTokens: num(json.usage?.completion_tokens),
    requestPayload: { url, method: "POST", body },
    responsePayload: json,
  };
}

async function callAnthropic(
  model: ModelRow,
  opts: LlmCallOptions,
  timeoutMs: number
): Promise<LlmResult> {
  const base = model.base_url?.replace(/\/+$/, "") || "https://api.anthropic.com";
  const url = `${base}/v1/messages`;

  const body: Record<string, unknown> = {
    model: model.model_id,
    max_tokens: opts.maxOutputTokens ?? 16384,
    messages: [{ role: "user", content: opts.prompt }],
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.topK != null) body.top_k = opts.topK;
  if (opts.topP != null) body.top_p = opts.topP;
  if (opts.thinkingLevel) {
    const budgets: Record<string, number> = { low: 2048, medium: 8192, high: 16384 };
    const budget = budgets[opts.thinkingLevel.toLowerCase()] ?? 8192;
    body.thinking = { type: "enabled", budget_tokens: budget };
  }

  const json = (await doFetch(
    url,
    { "x-api-key": model.api_key!, "anthropic-version": "2023-06-01" },
    body,
    timeoutMs
  )) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    output: (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
    inputTokens: num(json.usage?.input_tokens),
    outputTokens: num(json.usage?.output_tokens),
    requestPayload: { url, method: "POST", body },
    responsePayload: json,
  };
}

export function calcCost(model: ModelRow, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * (model.input_cost_per_1m ?? 0) +
    (outputTokens / 1_000_000) * (model.output_cost_per_1m ?? 0)
  );
}
