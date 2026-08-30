import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export interface ProjectCost {
  project_id: string;
  project_name: string;
  client_id: string;
  client_name: string;
  jobs: number;
  jobs_done: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

/** Aggregated cost tracking: per project, per client and grand total. */
export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { data: jobs, error } = await db()
    .from("jobs")
    .select("project_id, status, total_input_tokens, total_output_tokens, total_cost")
    .limit(10000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: projects, error: pErr } = await db()
    .from("projects")
    .select("id, name, client_id, clients(id, name)")
    .limit(1000);
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  const perProject = new Map<string, ProjectCost>();
  for (const p of projects ?? []) {
    const client = p.clients as unknown as { id: string; name: string } | null;
    perProject.set(p.id as string, {
      project_id: p.id as string,
      project_name: p.name as string,
      client_id: p.client_id as string,
      client_name: client?.name ?? "?",
      jobs: 0,
      jobs_done: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
    });
  }
  for (const j of jobs ?? []) {
    const agg = perProject.get(j.project_id as string);
    if (!agg) continue;
    agg.jobs += 1;
    if (j.status === "done") agg.jobs_done += 1;
    agg.input_tokens += Number(j.total_input_tokens ?? 0);
    agg.output_tokens += Number(j.total_output_tokens ?? 0);
    agg.cost += Number(j.total_cost ?? 0);
  }

  const perClient = new Map<
    string,
    { client_id: string; client_name: string; jobs: number; input_tokens: number; output_tokens: number; cost: number }
  >();
  for (const p of perProject.values()) {
    const c = perClient.get(p.client_id) ?? {
      client_id: p.client_id,
      client_name: p.client_name,
      jobs: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
    };
    c.jobs += p.jobs;
    c.input_tokens += p.input_tokens;
    c.output_tokens += p.output_tokens;
    c.cost += p.cost;
    perClient.set(p.client_id, c);
  }

  const projectList = [...perProject.values()].sort((a, b) => b.cost - a.cost);
  const clientList = [...perClient.values()].sort((a, b) => b.cost - a.cost);
  const total = projectList.reduce(
    (acc, p) => ({
      jobs: acc.jobs + p.jobs,
      input_tokens: acc.input_tokens + p.input_tokens,
      output_tokens: acc.output_tokens + p.output_tokens,
      cost: acc.cost + p.cost,
    }),
    { jobs: 0, input_tokens: 0, output_tokens: 0, cost: 0 }
  );

  return Response.json({ perProject: projectList, perClient: clientList, total });
}
