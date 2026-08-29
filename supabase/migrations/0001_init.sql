-- Rise Content Flow - initial schema

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null default 'gemini', -- gemini | openai | anthropic | perplexity | openai-compatible
  model_id text not null,
  api_key text,
  base_url text,
  input_cost_per_1m numeric not null default 0,
  output_cost_per_1m numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, model_id)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  ton_glosu text,
  brandbook text,
  wytyczne text,
  baza_wiedzy text,
  dane_1 text,
  dane_2 text,
  extra_json jsonb not null default '{}'::jsonb,
  wp_enabled boolean not null default false,
  wp_url text,
  wp_username text,
  wp_app_password text,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  description text,
  variables jsonb not null default '[]'::jsonb, -- [{key, label, required}]
  created_at timestamptz not null default now()
);

create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  position int not null,
  name text not null,
  prompt text not null default '',
  model_id uuid references models(id) on delete set null,
  temperature numeric,
  top_k numeric,
  top_p numeric,
  thinking_level text,
  max_output_tokens int,
  publish_wp_draft boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists stages_project_idx on stages(project_id, position);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text,
  status text not null default 'pending', -- pending | running | stopped | error | done
  variables jsonb not null default '{}'::jsonb,
  current_position int not null default 0, -- index (0-based) of the next enabled stage to run
  stop_requested boolean not null default false,
  error text,
  total_input_tokens bigint not null default 0,
  total_output_tokens bigint not null default 0,
  total_cost numeric not null default 0,
  wp_draft_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists jobs_project_idx on jobs(project_id, created_at desc);

create table if not exists stage_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  stage_id uuid,
  position int not null,
  stage_name text,
  model_snapshot jsonb,
  status text not null default 'running', -- running | success | error
  rendered_prompt text,
  request_payload jsonb,
  response_payload jsonb,
  output text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost numeric not null default 0,
  error text,
  attempt int not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists stage_runs_job_idx on stage_runs(job_id, position, started_at);

create table if not exists logs (
  id bigint generated always as identity primary key,
  level text not null default 'error', -- error | warn | info
  job_id uuid,
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists logs_created_idx on logs(created_at desc);

-- RLS: enabled with no policies. The app talks to the DB exclusively through
-- the service-role key on the server, which bypasses RLS. The anon key has no access.
alter table models enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table stages enable row level security;
alter table jobs enable row level security;
alter table stage_runs enable row level security;
alter table logs enable row level security;

-- Seed: models from the "Modele" sheet (API keys left empty - fill in the app settings)
insert into models (name, provider, model_id, input_cost_per_1m, output_cost_per_1m) values
  ('Gemini 3.5 Flash', 'gemini', 'gemini-3.5-flash', 1.5, 9.0),
  ('Gemini 3.1 Flash Lite', 'gemini', 'gemini-3.1-flash-lite', 0.25, 1.5),
  ('Gemini 3.1 Pro Preview', 'gemini', 'gemini-3.1-pro-preview', 2.0, 12.0),
  ('Gemini 3 Pro Preview', 'gemini', 'gemini-3-pro-preview', 2.0, 12.0),
  ('Gemini 3 Flash Preview', 'gemini', 'gemini-3-flash-preview', 0.5, 3.0),
  ('Gemini 2.5 Pro', 'gemini', 'gemini-2.5-pro', 1.25, 10.0),
  ('Gemini 2.5 Flash', 'gemini', 'gemini-2.5-flash', 0.3, 0.75),
  ('Gemini 2.5 Flash Lite', 'gemini', 'gemini-2.5-flash-lite', 0.1, 0.4),
  ('Gemini Deep Research Pro (12-2025)', 'gemini', 'deep-research-pro-preview-12-2025', 3.5, 3.5),
  ('Gemini Deep Research (04-2026)', 'gemini', 'deep-research-preview-04-2026', 4.8, 4.8),
  ('Perplexity Sonar', 'perplexity', 'sonar', 1.0, 1.0),
  ('Perplexity Sonar Pro', 'perplexity', 'sonar-pro', 3.0, 15.0),
  ('Perplexity Sonar Reasoning Pro', 'perplexity', 'sonar-reasoning-pro', 2.0, 8.0),
  ('Perplexity Sonar Deep Research', 'perplexity', 'sonar-deep-research', 2.0, 8.0)
on conflict (provider, model_id) do nothing;
