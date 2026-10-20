/**
 * Chocolatey automatico sugli host Windows (decisione di Riccardo, 21/10/2026).
 *
 * Prima Chocolatey si installava solo a mano, un host alla volta
 * (`POST /api/patch/bootstrap`): senza quel clic l'host non riceveva patch, e
 * nessuno lo ricordava. Ora, con il modulo Patch Management attivo e
 * l'interruttore della pagina del modulo acceso (lo è di default):
 *
 * 1. appena le credenziali WinRM di un host vengono salvate o verificate con
 *    successo (rotte delle credenziali → `avviaChocoDopoCredenziali`);
 * 2. ogni notte (`giroNotturnoChoco`, cron di `server.ts`) sugli host Windows
 *    con credenziale WinRM che non hanno Chocolatey o hanno un tentativo fallito.
 *
 * Regole:
 * - «Windows» = `hosts.os_family` Windows; «credenziale WinRM» = la regola del
 *   loader delle patch (`hostConCredenzialeWinrmDb`), compreso l'account WinRM
 *   dell'integrazione AD;
 * - già installato (ultimo probe riuscito senza CHOCO_MISSING, o ultimo
 *   bootstrap riuscito) → non si tocca;
 * - mai due operazioni insieme sullo stesso host: si salta se nello storico ce
 *   n'è una in coda o in corso, o se questo processo ci sta già lavorando;
 * - al massimo `INSTALLAZIONI_PARALLELE_MAX` installazioni insieme in tutto il
 *   processo (ognuna scarica e installa per 60-120 s);
 * - di notte al massimo `TENTATIVI_NOTTURNI_MAX` tentativi automatici falliti;
 *   poi l'host resta «fallito» finché un admin non lo riprova a mano (un
 *   bootstrap con utente ≠ 0 azzera il conto).
 *
 * Ogni tentativo è un bootstrap vero (`executeBootstrap`): una riga in
 * `patch_operations` con `user_id = 0` (automatico), esito e motivo dell'errore
 * nello storico dell'host.
 */
import type { Database } from "better-sqlite3";
import { getActiveTenants } from "@/lib/db-hub";
import { getTenantDb, getCurrentTenantCode, withTenant } from "@/lib/db-tenant";
import { hostConCredenzialeWinrmDb } from "./credentials";
import { isPatchEnabled } from "./feature";
import { patchModuleTablesExist } from "./schema";
import { executeBootstrap } from "./executor";

/** Impostazione del tenant: «0» = spento; assente o altro = acceso (default). */
export const CHIAVE_CHOCO_AUTOMATICO = "patch.choco_automatico";
/** Tentativi automatici falliti dopo i quali il giro notturno lascia stare l'host. */
export const TENTATIVI_NOTTURNI_MAX = 3;
/** Installazioni insieme in tutto il processo (tutti i tenant, tutti i giri). */
export const INSTALLAZIONI_PARALLELE_MAX = 3;
/** `patch_operations.user_id` delle operazioni partite da sole. */
export const UTENTE_AUTOMATICO = 0;

export function chocoAutomaticoAccesoDb(db: Database): boolean {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CHOCO_AUTOMATICO) as
    | { value: string }
    | undefined;
  return r?.value !== "0";
}

export function impostaChocoAutomaticoDb(db: Database, acceso: boolean): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_CHOCO_AUTOMATICO, acceso ? "1" : "0");
}

export interface StatoHostChoco {
  hostId: number;
  installato: boolean;
  occupato: boolean;
  /** Bootstrap automatici falliti dall'ultimo bootstrap fatto a mano da un admin. */
  fallitiAutomatici: number;
}

/**
 * Lo stato Chocolatey degli host Windows con credenziale WinRM, in una query
 * (niente N+1). `hostIds` = solo quelli; null = tutti.
 */
export function statoChocoHostDb(db: Database, hostIds: readonly number[] | null): StatoHostChoco[] {
  const conWinrm = hostConCredenzialeWinrmDb(db);
  const righe = db
    .prepare(
      `SELECT h.id AS host_id,
              (SELECT CASE WHEN po.action = 'bootstrap' THEN 1
                           WHEN COALESCE(po.error_message, '') = 'CHOCO_MISSING' THEN 0
                           ELSE 1 END
                 FROM patch_operations po
                WHERE po.host_id = h.id AND po.status = 'success' AND po.action IN ('probe', 'bootstrap')
                ORDER BY po.id DESC LIMIT 1) AS installato,
              EXISTS (SELECT 1 FROM patch_operations po
                       WHERE po.host_id = h.id AND po.status IN ('queued', 'running')
                         AND po.action IN ('bootstrap', 'upgrade', 'install', 'uninstall', 'rollback')) AS occupato,
              (SELECT COUNT(*) FROM patch_operations po
                WHERE po.host_id = h.id AND po.action = 'bootstrap' AND po.status = 'failed'
                  AND po.user_id = ${UTENTE_AUTOMATICO}
                  AND po.id > COALESCE((SELECT MAX(p2.id) FROM patch_operations p2
                                         WHERE p2.host_id = h.id AND p2.action = 'bootstrap'
                                           AND p2.user_id != ${UTENTE_AUTOMATICO}), 0)) AS falliti
         FROM hosts h
        WHERE LOWER(COALESCE(h.os_family, '')) = 'windows'
        ORDER BY h.id`,
    )
    .all() as Array<{ host_id: number; installato: number | null; occupato: number; falliti: number }>;
  const scelti = hostIds ? new Set(hostIds) : null;
  return righe
    .filter((r) => conWinrm.has(r.host_id) && (!scelti || scelti.has(r.host_id)))
    .map((r) => ({
      hostId: r.host_id,
      installato: r.installato === 1,
      occupato: r.occupato === 1,
      fallitiAutomatici: r.falliti,
    }));
}

export interface RiepilogoChoco {
  /** Host Windows con credenziale WinRM. */
  host: number;
  installati: number;
  /** Senza Chocolatey (o mai controllati), si provano al prossimo giro. */
  daInstallare: number;
  /** Con almeno un tentativo automatico fallito, sotto il limite: si ritentano. */
  falliti: number;
  /** Arrivati al limite di tentativi: aspettano un admin. */
  fermi: number;
}

export function riepilogoChocoDb(db: Database): RiepilogoChoco {
  const stati = statoChocoHostDb(db, null);
  const out: RiepilogoChoco = { host: stati.length, installati: 0, daInstallare: 0, falliti: 0, fermi: 0 };
  for (const s of stati) {
    if (s.installato) out.installati++;
    else if (s.fallitiAutomatici >= TENTATIVI_NOTTURNI_MAX) out.fermi++;
    else if (s.fallitiAutomatici > 0) out.falliti++;
    else out.daInstallare++;
  }
  return out;
}

// ─── Esecuzione: un host alla volta per host, al massimo N insieme ──────────

const inCorso = new Set<string>();
let attive = 0;
const inAttesa: Array<() => void> = [];

/** Il posto passa direttamente a chi aspetta: nessuno lo può prendere in mezzo. */
async function conPosto<T>(fn: () => Promise<T>): Promise<T> {
  if (attive >= INSTALLAZIONI_PARALLELE_MAX) {
    await new Promise<void>((r) => inAttesa.push(r));
  } else {
    attive++;
  }
  try {
    return await fn();
  } finally {
    const prossimo = inAttesa.shift();
    if (prossimo) prossimo();
    else attive--;
  }
}

export interface DipendenzeChoco {
  moduloAttivo: (tenantCode: string) => Promise<boolean>;
  bootstrap: (tenantCode: string, hostId: number) => Promise<{ success: boolean }>;
}

const dipendenzeVere: DipendenzeChoco = {
  moduloAttivo: (code) => isPatchEnabled(code),
  bootstrap: (code, hostId) =>
    withTenant(code, () => executeBootstrap({ hostId, userId: UTENTE_AUTOMATICO, tenantCode: code })),
};

export interface EsitoGiroChoco {
  avviati: number;
  riusciti: number;
}

/**
 * Installa Chocolatey sugli host che ne hanno bisogno e aspetta la fine.
 * `hostIds` null = tutti gli host Windows con credenziale WinRM (giro
 * notturno); `notte` applica il limite di tentativi. Non lancia mai.
 */
export async function installaChocoSuHostDb(
  db: Database,
  tenantCode: string,
  hostIds: readonly number[] | null,
  opts: { notte: boolean },
  deps: DipendenzeChoco = dipendenzeVere,
): Promise<EsitoGiroChoco> {
  const esito: EsitoGiroChoco = { avviati: 0, riusciti: 0 };
  try {
    if (!(await deps.moduloAttivo(tenantCode))) return esito;
    if (!patchModuleTablesExist(db) || !chocoAutomaticoAccesoDb(db)) return esito;

    const candidati = statoChocoHostDb(db, hostIds).filter(
      (s) =>
        !s.installato &&
        !s.occupato &&
        !inCorso.has(`${tenantCode}:${s.hostId}`) &&
        (!opts.notte || s.fallitiAutomatici < TENTATIVI_NOTTURNI_MAX),
    );
    // Il lucchetto per host si prende subito, prima di aspettare il posto.
    const presi = candidati.map((s) => s.hostId).filter((id) => {
      const chiave = `${tenantCode}:${id}`;
      if (inCorso.has(chiave)) return false;
      inCorso.add(chiave);
      return true;
    });
    esito.avviati = presi.length;

    await Promise.all(
      presi.map((hostId) =>
        conPosto(async () => {
          try {
            const r = await deps.bootstrap(tenantCode, hostId);
            if (r.success) esito.riusciti++;
          } catch (e) {
            console.error(`[patch/choco-automatico] bootstrap dell'host #${hostId} (tenant ${tenantCode}) non partito:`, (e as Error).message);
          } finally {
            inCorso.delete(`${tenantCode}:${hostId}`);
          }
        }),
      ),
    );
  } catch (e) {
    console.error(`[patch/choco-automatico] giro del tenant ${tenantCode} interrotto:`, (e as Error).message);
  }
  return esito;
}

/**
 * Dopo un salvataggio o una verifica riuscita di credenziali WinRM: parte in
 * sottofondo (la rotta risponde subito) sul tenant della richiesta.
 */
export function avviaChocoDopoCredenziali(hostIds: readonly number[]): void {
  const code = getCurrentTenantCode();
  if (!code || hostIds.length === 0) return;
  void withTenant(code, () => installaChocoSuHostDb(getTenantDb(code), code, hostIds, { notte: false }));
}

/** Il giro notturno, tenant per tenant. */
export async function giroNotturnoChoco(): Promise<void> {
  for (const t of getActiveTenants()) {
    const code = t.codice_cliente;
    try {
      const r = await withTenant(code, () => installaChocoSuHostDb(getTenantDb(code), code, null, { notte: true }));
      if (r.avviati > 0) {
        console.warn(`[patch/choco-automatico] tenant ${code}: ${r.riusciti}/${r.avviati} installazioni di Chocolatey riuscite`);
      }
    } catch (e) {
      console.error(`[patch/choco-automatico] tenant ${code}:`, (e as Error).message);
    }
  }
}
