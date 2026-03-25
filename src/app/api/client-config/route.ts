import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { getClientConfig, saveClientConfig, deleteClientConfig, listClientConfigs } from "@/lib/client-config";
import type { ClientConfig } from "@/lib/client-config";

/**
 * GET /api/client-config
 * - Senza query param: lista tutti i codici con config salvata
 * - Con ?code=XXX: ritorna la config del cliente
 */
export async function GET(req: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    const codes = listClientConfigs();
    return NextResponse.json(codes);
  }

  const config = getClientConfig(code);
  if (!config) {
    return NextResponse.json({ error: "Configurazione non trovata" }, { status: 404 });
  }
  return NextResponse.json(config);
}

/**
 * PUT /api/client-config?code=XXX
 * Salva (crea o aggiorna) la config del cliente. Scrive JSON + MD.
 */
export async function PUT(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Parametro 'code' richiesto" }, { status: 400 });
  }

  let data: ClientConfig;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  if (!data.cliente?.cliente || !data.cliente?.cod_cliente) {
    return NextResponse.json({ error: "Campi cliente.cliente e cliente.cod_cliente obbligatori" }, { status: 400 });
  }

  try {
    saveClientConfig(code, data);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: `Errore nel salvataggio: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}

/**
 * DELETE /api/client-config?code=XXX
 * Elimina la config del cliente (cartella + file).
 */
export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Parametro 'code' richiesto" }, { status: 400 });
  }

  const deleted = deleteClientConfig(code);
  if (!deleted) {
    return NextResponse.json({ error: "Configurazione non trovata" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
