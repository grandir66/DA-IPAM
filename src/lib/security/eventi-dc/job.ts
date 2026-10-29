/**
 * Lettura degli eventi dei domain controller ogni 5 minuti (29/10/2026), avviata da `server.ts`.
 *
 * Per ogni cliente con un'integrazione AD che ha la credenziale WinRM del DC. Di serie («auto») legge
 * solo dove Wazuh non legge già gli allarmi; si sceglie per cliente in Opzioni (`automatismo.eventi_dc`).
 * Un giro per cliente alla volta: chi chiede mentre gira (pulsante «Aggiorna ora») riceve la stessa
 * promessa. Stato su globalThis come `trunk/job.ts`: rotte e `server.ts` hanno istanze diverse.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { getCurrentTenantCode, getTenantDb, withTenant } from "@/lib/db-tenant";
import { notifyPendingEvents } from "@/lib/integrations/wazuh-alerts-sync";
import { giroEventiDc, type EsitoGiroDc } from "./raccolta";

export const CRON_EVENTI_DC = "*/5 * * * *";
export const CHIAVE_ULTIMO_GIRO_DC = "eventi_dc.ultimo_giro";

export interface UltimoGiroDc {
  il: string;
  ok: boolean;
  testo: string;
}

interface StatoGiro {
  inCorso: Map<string, Promise<EsitoGiroDc>>;
  avviato: boolean;
}
const g = globalThis as typeof globalThis & { __giroEventiDc?: StatoGiro };
const stato = (): StatoGiro => (g.__giroEventiDc ??= { inCorso: new Map(), avviato: false });

export function testoEsitoDc(e: EsitoGiroDc): { ok: boolean; testo: string } {
  if (e.saltato) return { ok: true, testo: `non legge: ${e.saltato}` };
  const guasti = e.dc.filter((d) => !d.ok);
  const nuovi = e.dc.reduce((s, d) => s + d.nuovi, 0);
  const persi = e.dc.reduce((s, d) => s + d.persi, 0);
  const parti = [`${e.dc.length - guasti.length}/${e.dc.length} DC letti`, `${nuovi} eventi nuovi`];
  if (persi > 0) parti.push(`circa ${persi} record persi: registro Sicurezza troppo piccolo`);
  for (const d of guasti) parti.push(`${d.dc}: ${d.errore ?? "errore"}`);
  return { ok: guasti.length === 0, testo: parti.join(" · ").slice(0, 400) };
}

async function giroCliente(tenantCode: string): Promise<EsitoGiroDc> {
  const db = getTenantDb(tenantCode);
  return withTenant(tenantCode, async () => {
    let esito: EsitoGiroDc;
    try {
      esito = await giroEventiDc(db);
      if (!esito.saltato) await notifyPendingEvents(db, tenantCode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[eventi-dc] ${tenantCode}: giro fallito:`, msg);
      esito = { saltato: null, dc: [{ dc: "—", ok: false, eventi: 0, nuovi: 0, persi: 0, errore: msg }], aperti: 0 };
    }
    try {
      const t = testoEsitoDc(esito);
      db.prepare(
        `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ).run(CHIAVE_ULTIMO_GIRO_DC, JSON.stringify({ il: new Date().toISOString(), ...t } satisfies UltimoGiroDc));
    } catch (e) {
      console.error(`[eventi-dc] ${tenantCode}: esito del giro non scritto:`, e);
    }
    return esito;
  });
}

/** Un giro per il cliente, se non ne sta già girando uno (in quel caso, la stessa promessa). */
export function giroEventiDcAdesso(tenantCode: string): Promise<EsitoGiroDc> {
  const s = stato();
  const corrente = s.inCorso.get(tenantCode);
  if (corrente) return corrente;
  const p = giroCliente(tenantCode).finally(() => s.inCorso.delete(tenantCode));
  s.inCorso.set(tenantCode, p);
  return p;
}

/** Il giro del cliente del contesto (rotte). */
export function giroEventiDcDelContesto(): Promise<EsitoGiroDc> {
  const code = getCurrentTenantCode();
  if (!code) return Promise.reject(new Error("Nessun contesto del cliente"));
  return giroEventiDcAdesso(code);
}

export function ultimoGiroDc(tenantCode: string): UltimoGiroDc | null {
  try {
    const r = getTenantDb(tenantCode).prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_ULTIMO_GIRO_DC) as { value: string } | undefined;
    if (!r) return null;
    const o = JSON.parse(r.value) as Partial<UltimoGiroDc>;
    return typeof o.il === "string" && typeof o.ok === "boolean" && typeof o.testo === "string" ? { il: o.il, ok: o.ok, testo: o.testo } : null;
  } catch {
    return null;
  }
}

export async function giroEventiDcTutti(): Promise<void> {
  for (const t of getActiveTenants()) {
    try {
      const esito = await giroEventiDcAdesso(t.codice_cliente);
      const nuovi = esito.dc.reduce((s, d) => s + d.nuovi, 0);
      if (nuovi > 0) console.info(`[eventi-dc] ${t.codice_cliente}: ${nuovi} eventi nuovi dai DC, ${esito.aperti} aperti`);
    } catch (e) {
      console.warn(`[eventi-dc] ${t.codice_cliente}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaLetturaEventiDc(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_EVENTI_DC, () => void giroEventiDcTutti());
}
