export type Provider =
  | "gemini"
  | "openai"
  | "anthropic"
  | "perplexity"
  | "openai-compatible";

export interface ModelRow {
  id: string;
  name: string;
  provider: Provider;
  model_id: string;
  api_key: string | null;
  base_url: string | null;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  active: boolean;
  created_at: string;
}

export interface ClientRow {
  id: string;
  name: string;
  website: string | null;
  ton_glosu: string | null;
  brandbook: string | null;
  wytyczne: string | null;
  baza_wiedzy: string | null;
  dane_1: string | null;
  dane_2: string | null;
  extra_json: Record<string, unknown>;
  wp_enabled: boolean;
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password: string | null;
  created_at: string;
}

export interface VariableDef {
  key: string;
  label?: string;
  required: boolean;
}

export interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  variables: VariableDef[];
  created_at: string;
}

export interface StageRow {
  id: string;
  project_id: string;
  position: number;
  name: string;
  prompt: string;
  model_id: string | null;
  temperature: number | null;
  top_k: number | null;
  top_p: number | null;
  thinking_level: string | null;
  max_output_tokens: number | null;
  publish_wp_draft: boolean;
  enabled: boolean;
  created_at: string;
}

export type JobStatus = "pending" | "running" | "stopped" | "error" | "done" | "review";

export interface JobRow {
  id: string;
  project_id: string;
  name: string | null;
  status: JobStatus;
  variables: Record<string, string>;
  current_position: number;
  stop_requested: boolean;
  error: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  wp_draft_url: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface StageRunRow {
  id: string;
  job_id: string;
  stage_id: string | null;
  position: number;
  stage_name: string | null;
  model_snapshot: Record<string, unknown> | null;
  status: "running" | "success" | "error";
  rendered_prompt: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: unknown;
  output: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  error: string | null;
  attempt: number;
  started_at: string;
  finished_at: string | null;
}

export interface LogRow {
  id: number;
  level: "error" | "warn" | "info";
  job_id: string | null;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}
