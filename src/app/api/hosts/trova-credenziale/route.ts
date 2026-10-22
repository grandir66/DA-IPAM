import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { avviaChocoDopoCredenziali } from "@/lib/patch/choco-automatico";
import { candidatiPerHost, provaCredenzialeSuHost, trovaCredenziale, type EsitoRicerca } from "@/lib/credentials/trova";

/**
 * Ricerca della credenziale che funziona su uno o più host (tappe 3-5, T3, 21/10).
 * - GET `?host_id=&protocollo=&porta=` → candidati in ordine, con le escluse e la data: non prova nulla.
 * - POST `{ host_ids: number[] (1..50), protocollo, porta }` → `EsitoRicerca[]`, host in sequenza (solo amministratori:
 *   tenta accessi veri). Windows: al più 3 tentativi per host.
 * Logica in `src/lib/credentials/trova.ts`.
 */
const PROTOCOLLI = ["ssh", "snmp_v2", "snmp_v3", "winrm", "api"] as const;
const porta = z.number().int().min(1).max(65535);

const corpoPost = z.object({
  host_ids: z.array(z.number().int().positive()).min(1, "Indica almeno un host").max(50, "Al più 50 host per volta"),
  protocollo: z.enum(PROTOCOLLI),
  porta,
  /** Credenziali già rifiutate 3 volte in questo giro su altri host (conta il client, solo Windows). */
  escludi_credenziali: z.array(z.number().int().positive()).max(200).optional(),
});

const queryGet = z.object({
  host_id: z.coerce.number().int().positive(),
  protocollo: z.enum(PROTOCOLLI),
  porta: z.coerce.number().int().min(1).max(65535),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    const url = new URL(req.url);
    const p = queryGet.safeParse(Object.fromEntries(url.searchParams));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Parametri non validi" }, { status: 400 });
    const candidati = candidatiPerHost(getDb(), p.data.host_id, p.data.protocollo, p.data.porta);
    return NextResponse.json({ host_id: p.data.host_id, candidati }, { headers: NO_STORE });
  });
}

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const p = corpoPost.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
    try {
      const dbh = getDb();
      const esiti: EsitoRicerca[] = [];
      for (const hostId of p.data.host_ids) {
        const host = dbh.prepare(`SELECT ip FROM hosts WHERE id = ?`).get(hostId) as { ip: string } | undefined;
        if (!host) {
          esiti.push({ hostId, trovata: null, tentativi: [] });
          continue;
        }
        esiti.push(
          await trovaCredenziale(dbh, hostId, p.data.protocollo, p.data.porta, async (credentialId) => {
            const e = await provaCredenzialeSuHost(dbh, credentialId, host.ip, p.data.porta);
            // un segreto mancante o un tipo non provabile non è un rifiuto dell'host: non lascia traccia
            return { ok: e.ok, errore: e.ok ? undefined : e.errore, nonProvata: !e.registra, trasporto: e.trasporto };
          }, { escludi: p.data.escludi_credenziali }),
        );
      }
      // WinRM verificato: Chocolatey si installa da solo, se serve (come dopo la «Prova» a mano, 21/10).
      if (p.data.protocollo === "winrm") {
        const trovati = esiti.filter((e) => e.trovata).map((e) => e.hostId);
        if (trovati.length > 0) avviaChocoDopoCredenziali(trovati);
      }
      return NextResponse.json(esiti, { headers: NO_STORE });
    } catch (error) {
      console.error("[hosts] trova-credenziale:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Errore nella ricerca della credenziale" }, { status: 500 });
    }
  });
}
