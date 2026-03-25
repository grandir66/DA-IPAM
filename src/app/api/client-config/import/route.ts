import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { saveClientConfig } from "@/lib/client-config";
import type { ClientConfig } from "@/lib/client-config";

/**
 * POST /api/client-config/import?code=XXX
 * Importa un file JSON (generato dallo script Python o esportato dal sistema).
 * Body: il JSON della configurazione cliente.
 */
export async function POST(req: Request) {
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
    return NextResponse.json(
      { error: "JSON non valido: campi cliente.cliente e cliente.cod_cliente obbligatori" },
      { status: 400 }
    );
  }

  try {
    saveClientConfig(code, data);
    return NextResponse.json({ success: true, code });
  } catch (e) {
    return NextResponse.json(
      { error: `Errore nell'importazione: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
