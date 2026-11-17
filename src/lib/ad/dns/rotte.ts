/** Pezzi comuni alle rotte delle correzioni DNS: integrazione dal percorso, corpo JSON, nome di chi agisce. */
import { NextResponse } from "next/server";
import { getAdIntegrationById, type AdIntegration } from "@/lib/db-tenant";

export async function integrazioneDa(params: Promise<{ id: string }>): Promise<AdIntegration | NextResponse> {
  const id = Number.parseInt((await params).id, 10);
  const integrazione = Number.isInteger(id) ? getAdIntegrationById(id) : undefined;
  return integrazione ?? NextResponse.json({ error: "Integrazione non trovata" }, { status: 404 });
}

export async function corpoJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

export function chi(sessione: { user?: { name?: string | null; email?: string | null } | null }): string {
  return sessione.user?.name ?? sessione.user?.email ?? "sconosciuto";
}
