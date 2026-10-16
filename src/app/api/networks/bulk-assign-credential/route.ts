import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { assegnaVociAiRouterDb, RifiutoCredenziali, type SceltaVoci } from "@/lib/credentials/apparato-archivio";

/** 0 o null = «Nessuna» (toglie i binding di quel protocollo), assente = non modificare. */
const IdVoce = z.coerce.number().int().min(0, "Credenziale non valida").optional().nullable();

const AssegnaSchema = z.object({
  network_ids: z.array(z.coerce.number().int().positive()).min(1, "Seleziona almeno una rete"),
  credential_id: IdVoce,
  snmp_credential_id: IdVoce,
  /** L'utente ha confermato la rimozione dei binding: senza, la risposta è 409 con la domanda. */
  conferma_rimozione: z.boolean().optional(),
});

/**
 * Assegna credenziali (SSH e/o SNMP) ai router delle reti selezionate.
 * POST /api/networks/bulk-assign-credential
 * Body: { network_ids: number[], credential_id?: number | null, snmp_credential_id?: number | null, conferma_rimozione?: boolean }
 * Le credenziali devono essere scelte da quelle registrate.
 * credential_id = accesso del router (SSH per l'ARP), snmp_credential_id = SNMP (porte, LLDP).
 *
 * Dalla 2e (tappa 2 credenziali, T20, 16/10) la voce va nei binding del
 * router, in testa a quelli del suo protocollo (regola tipo ↔ protocollo:
 * una SSH su un router SNMP diventa il suo login SSH), come la modifica in
 * blocco degli apparati; null toglie i binding di quel protocollo, dopo la
 * conferma. Prima si scrivevano le colonne del router (con la community
 * cifrata), che la pagina non mostra e che dopo la 2g nessuno leggerebbe:
 * «Credenziali assegnate a N router» senza effetto.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const parsed = AssegnaSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
      }
      const { network_ids: networkIds, conferma_rimozione } = parsed.data;
      const scelte: SceltaVoci = {};
      for (const campo of ["credential_id", "snmp_credential_id"] as const) {
        if (campo in parsed.data && parsed.data[campo] !== undefined) scelte[campo] = parsed.data[campo] || null;
      }
      if (Object.keys(scelte).length === 0) {
        return NextResponse.json({ error: "Indica almeno una credenziale SSH o SNMP registrata" }, { status: 400 });
      }

      const esito = assegnaVociAiRouterDb(getDb(), networkIds, scelte, { conferma: conferma_rimozione === true });
      const toccati = esito.router - new Set(esito.saltati.map((x) => x.device_id)).size;
      const parti = [`Credenziali assegnate a ${toccati} router`];
      if (esito.tolti > 0) parti.push(`${esito.tolti} binding tolti`);
      if (esito.saltati.length > 0) {
        parti.push(`non assegnate a ${esito.saltati.map((x) => `«${x.nome}»`).join(", ")}: ${esito.saltati[0].motivo}`);
      }

      return NextResponse.json({
        success: true,
        networks_processed: networkIds.length,
        devices_updated: toccati,
        credenziali: esito,
        message: parti.join("; "),
      });
    } catch (error) {
      if (error instanceof RifiutoCredenziali) {
        return NextResponse.json({ error: error.message, ...(error.conferma ? { conferma: error.conferma } : {}) }, { status: error.stato });
      }
      console.error("Bulk assign credential error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'assegnazione" },
        { status: 500 }
      );
    }
  });
}
