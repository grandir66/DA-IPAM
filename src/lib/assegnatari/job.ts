/**
 * Il giro orario degli accessi ai PC (piano 2026-10-23-assegnatari-da-ad, passo 3), avviato da `server.ts`.
 *
 * Nasce spento: gira solo per i clienti con l'interruttore acceso in Opzioni (`automatismo.accessi_pc`, chiave
 * `assegnatari.giro_accessi` = «1»). Ogni ora al minuto 17, e 3 minuti dopo l'avvio; accendendolo da Opzioni parte
 * subito un giro per quel cliente. Un giro per cliente alla volta: chi chiede mentre gira riceve la stessa promessa.
 * Lo stato sta su globalThis, come `vulcan/job.ts`: le rotte di Next e `server.ts` caricano istanze diverse del modulo.
 *
 * Non scrive assegnatari né asset: riempie solo `host_accessi_utente` e cancella le righe oltre i 90 giorni. L'esito
 * dell'ultimo giro sta in `assegnatari.ultimo_giro` (Opzioni lo mostra).
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb, schemaAssegnatariAdPresente } from "@/lib/db-tenant";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import { CHIAVE_ULTIMO_GIRO, giroAccessiAcceso, pulisciAccessi, scriviImpostazione, soglieDelCliente } from "./db";
import { raccogliAccessi, type EsitoRaccolta, type IndexerAccessi } from "./raccolta";

export const CRON_ACCESSI = "17 * * * *";
export const PRIMO_MS = 180_000;

export interface UltimoGiro {
  il: string;
  ok: boolean;
  testo: string;
}

interface StatoGiro {
  inCorso: Map<string, Promise<UltimoGiro>>;
  avviato: boolean;
}
const g = globalThis as typeof globalThis & { __giroAccessiPc?: StatoGiro };
const stato = (): StatoGiro => (g.__giroAccessiPc ??= { inCorso: new Map(), avviato: false });

function indexerDelWazuh(): IndexerAccessi | null {
  const cfg = getWazuhConfig();
  if (!cfg.enabled || !cfg.indexerUrl) return null;
  return createWazuhIndexerClient({
    url: cfg.indexerUrl,
    username: cfg.indexerUsername,
    password: cfg.indexerPassword,
    verifyTls: cfg.verifyTls,
  });
}

function testoEsito(e: EsitoRaccolta, wazuh: boolean): string {
  const parti = [
    wazuh ? `Wazuh: ${e.righe} righe da ${e.finestre} ${e.finestre === 1 ? "finestra" : "finestre"}` : "Wazuh non configurato",
    `WinRM: ${e.winrm}`,
  ];
  if (e.senzaHost > 0) parti.push(`${e.senzaHost} postazioni senza host`);
  return parti.join(" · ");
}

async function giroCliente(tenantCode: string): Promise<UltimoGiro> {
  const db = getTenantDb(tenantCode);
  const il = new Date().toISOString().replace("T", " ").slice(0, 19);
  let esito: UltimoGiro;
  try {
    const indexer = indexerDelWazuh();
    const r = await raccogliAccessi(db, indexer, { giorni: soglieDelCliente(db).giorni });
    pulisciAccessi(db);
    esito = { il, ok: true, testo: testoEsito(r, indexer !== null) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[assegnatari] ${tenantCode}: giro degli accessi fallito:`, msg);
    esito = { il, ok: false, testo: msg.slice(0, 300) };
  }
  try {
    scriviImpostazione(db, CHIAVE_ULTIMO_GIRO, JSON.stringify(esito));
  } catch (e) {
    console.error(`[assegnatari] ${tenantCode}: esito del giro non scritto:`, e);
  }
  return esito;
}

/** Un giro per il cliente, se non ne sta già girando uno (in quel caso, la stessa promessa). */
export function giroAccessiAdesso(tenantCode: string): Promise<UltimoGiro> {
  const s = stato();
  const corrente = s.inCorso.get(tenantCode);
  if (corrente) return corrente;
  const p = giroCliente(tenantCode).finally(() => s.inCorso.delete(tenantCode));
  s.inCorso.set(tenantCode, p);
  return p;
}

/** I clienti con il giro acceso e lo schema a posto. */
function clientiAccesi(): string[] {
  const out: string[] = [];
  for (const t of getActiveTenants()) {
    try {
      const db = getTenantDb(t.codice_cliente);
      if (schemaAssegnatariAdPresente(db) && giroAccessiAcceso(db)) out.push(t.codice_cliente);
    } catch (e) {
      console.error(`[assegnatari] ${t.codice_cliente}: cliente non leggibile, salto:`, e);
    }
  }
  return out;
}

export async function giroTutti(): Promise<void> {
  for (const code of clientiAccesi()) await giroAccessiAdesso(code);
}

/** Avvia il cron orario e il primo giro; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaGiroAccessi(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_ACCESSI, () => void giroTutti());
  setTimeout(() => void giroTutti(), PRIMO_MS).unref?.();
}
