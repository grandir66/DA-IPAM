/**
 * Il pannello Zabbix in sola lettura (passo 7.4). GET per chi ha una sessione (la
 * chiave non esce mai); POST «Riprova adesso» solo admin: ignora l'attesa crescente.
 */
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { leggiPannello } from "@/lib/zabbix-lettura/servizio";

function richiesta(req: Request) {
  const q = new URL(req.url).searchParams;
  const pagina = Number(q.get("pagina") ?? "1");
  return {
    pagina: Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : 1,
    soloQuestaMacchina: q.get("solo") === "macchina",
  };
}

export async function GET(req: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  const r = richiesta(req);
  return withTenantFromSession(async () => {
    const pannello = await leggiPannello(dipendenzeReali(), r);
    return NextResponse.json(pannello, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  const r = richiesta(req);
  return withTenantFromSession(async () => {
    const pannello = await leggiPannello(dipendenzeReali(), { ...r, forza: true });
    return NextResponse.json(pannello, { headers: { "Cache-Control": "no-store" } });
  });
}
