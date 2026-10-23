import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { registroVisualizzazioni } from "@/lib/vault/mostra";

/**
 * Chi ha visto una password o esportato l'archivio, e quando (il cliente lo vede). A pagine, senza valori. Solo admin
 * (tecnici Domarc e admin del cliente, D2): il registro riporta i nomi delle credenziali e delle persone.
 */
export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const url = new URL(request.url);
    const pagina = Number(url.searchParams.get("pagina") ?? "1") || 1;
    const perPagina = Number(url.searchParams.get("per_pagina") ?? "50") || 50;
    return NextResponse.json(registroVisualizzazioni(getDb(), { pagina, perPagina }));
  });
}
