import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ModelRow } from "@/lib/types";
import { maskModel } from "@/lib/maskModel";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { data, error } = await db().from("models").select("*").order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json((data as ModelRow[]).map(maskModel));
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const body = await req.json();
  const insert = {
    name: body.name,
    provider: body.provider ?? "gemini",
    model_id: body.model_id,
    api_key: body.api_key || null,
    base_url: body.base_url || null,
    input_cost_per_1m: body.input_cost_per_1m ?? 0,
    output_cost_per_1m: body.output_cost_per_1m ?? 0,
    active: body.active ?? true,
  };
  if (!insert.name || !insert.model_id) {
    return Response.json({ error: "Nazwa i ID modelu są wymagane" }, { status: 400 });
  }
  const { data, error } = await db().from("models").insert(insert).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(maskModel(data as ModelRow));
}
