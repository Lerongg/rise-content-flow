import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const { data, error } = await db()
    .from("clients")
    .select("id, name, website, wp_enabled, created_at, projects(count)")
    .order("name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const body = await req.json();
  if (!body.name) return Response.json({ error: "Nazwa klienta jest wymagana" }, { status: 400 });
  const insert = {
    name: body.name,
    website: body.website || null,
    ton_glosu: body.ton_glosu || null,
    brandbook: body.brandbook || null,
    wytyczne: body.wytyczne || null,
    baza_wiedzy: body.baza_wiedzy || null,
    dane_1: body.dane_1 || null,
    dane_2: body.dane_2 || null,
    extra_json: body.extra_json ?? {},
    wp_enabled: body.wp_enabled ?? false,
    wp_url: body.wp_url || null,
    wp_username: body.wp_username || null,
    wp_app_password: body.wp_app_password || null,
  };
  const { data, error } = await db().from("clients").insert(insert).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
