/**
 * Un giro di lettura dei domain controller di un cliente.
 *
 * Per ogni integrazione AD con la credenziale WinRM del DC: i DC sono i computer di AD nell'OU
 * «Domain Controllers» (ognuno registra solo i propri accessi, si leggono tutti), o il solo DC
 * dell'integrazione se la sincronizzazione LDAP non li ha ancora portati. Ogni DC si legge dal suo
 * cursore; gli eventi nuovi vanno nell'archivio dei DC (grafici) e nella coda della pagina (presa in
 * carico, notifiche), nella stessa transazione del cursore: un giro rotto a metà non conta due volte.
 */

import type { Database } from "better-sqlite3";
import { accessoWinrmDelDcDb } from "@/lib/ad/credenziale-ldap";
import { runWinrmCommand } from "@/lib/devices/winrm-run";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";
import { collectSelfIdentity } from "@/lib/integrations/self-identity";
import { ensureWazuhAlertSchema, upsertAlertEvent } from "@/lib/integrations/wazuh-alerts-db";
import {
  ensureEventiDcSchema,
  eliminaEventiDcVecchi,
  letturaDc,
  salvaEventiDc,
  scriviLetturaFallita,
  scriviLetturaRiuscita,
} from "./db";
import { classificaEvento, comeAlert, eAllarme, leggiRispostaDc, prossimoCursore, scriptEventiDc, type EventoDc } from "./eventi";

/** Impostazione del cliente: «auto» (di serie), «sempre», «mai». */
export const CHIAVE_MODO_EVENTI_DC = "eventi_dc.modo";
export type ModoEventiDc = "auto" | "sempre" | "mai";

export function modoEventiDc(db: Database): ModoEventiDc {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_MODO_EVENTI_DC) as { value: string } | undefined;
  return r?.value === "sempre" || r?.value === "mai" ? r.value : "auto";
}

export function scriviModoEventiDc(db: Database, modo: ModoEventiDc): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_MODO_EVENTI_DC, modo);
}

/** Wazuh legge già gli allarmi (integrazione accesa e indexer configurato). */
export function wazuhLeggeGliAllarmi(): boolean {
  const c = getWazuhConfig();
  return Boolean(c.enabled && c.indexerUrl && c.indexerUsername && c.indexerPassword);
}

/** Perché il giro non legge, o null se legge. «auto» lascia il posto a Wazuh: i due insieme conterebbero due volte. */
export function motivoPerNonLeggere(modo: ModoEventiDc, wazuh: boolean): string | null {
  if (modo === "mai") return "spento per questo cliente";
  if (modo === "auto" && wazuh) return "Wazuh legge già gli allarmi";
  return null;
}

export interface DcDaLeggere {
  integrationId: number;
  dc: string;
  realm: string;
  credentialId: number;
}

/** I DC di ogni integrazione con la credenziale WinRM: per nome DNS, così Kerberos trova il servizio. */
export function dcDaLeggere(db: Database): DcDaLeggere[] {
  const integrazioni = db
    .prepare("SELECT id, dc_host, domain, winrm_credential_id FROM ad_integrations WHERE enabled = 1 AND winrm_credential_id IS NOT NULL ORDER BY id")
    .all() as Array<{ id: number; dc_host: string; domain: string; winrm_credential_id: number }>;
  const out: DcDaLeggere[] = [];
  const visti = new Set<string>();
  const perIntegrazione = db.prepare(
    `SELECT dns_host_name, sam_account_name FROM ad_computers
      WHERE integration_id = ? AND enabled = 1 AND distinguished_name LIKE '%OU=Domain Controllers,%' COLLATE NOCASE
      ORDER BY dns_host_name`,
  );
  for (const i of integrazioni) {
    const nomi = (perIntegrazione.all(i.id) as Array<{ dns_host_name: string | null; sam_account_name: string }>)
      .map((c) => (c.dns_host_name ?? "").trim() || c.sam_account_name.replace(/\$$/, ""))
      .filter(Boolean);
    for (const dc of nomi.length ? nomi : [i.dc_host]) {
      const k = dc.toLowerCase();
      if (visti.has(k)) continue;
      visti.add(k);
      out.push({ integrationId: i.id, dc, realm: i.domain, credentialId: i.winrm_credential_id });
    }
  }
  return out;
}

export interface EsitoDc {
  dc: string;
  ok: boolean;
  eventi: number;
  nuovi: number;
  persi: number;
  errore?: string;
}

export interface EsitoGiroDc {
  saltato: string | null;
  dc: EsitoDc[];
  aperti: number;
}

/** Il comando WinRM (sostituibile nelle prove). */
export type EseguiWinrm = typeof runWinrmCommand;

/** Legge un DC e salva; non lancia: l'errore resta nello stato del DC. */
export async function leggiUnDc(db: Database, d: DcDaLeggere, esegui: EseguiWinrm, self = collectSelfIdentity(db)): Promise<EsitoDc & { aperti: number }> {
  const prima = letturaDc(db, d.dc);
  const cursore = prima?.ultimoRecord ?? null;
  try {
    const accesso = accessoWinrmDelDcDb(db, d.credentialId);
    if (!accesso.ok) throw new Error(accesso.motivo);
    const raw = await esegui(d.dc, accesso.port, accesso.username, accesso.password, scriptEventiDc(cursore), true, d.realm);
    const r = leggiRispostaDc(raw);
    if (r.errore) throw new Error(`il DC non ha dato il registro Sicurezza: ${r.errore}`);
    const prossimo = prossimoCursore(cursore, r);
    const eventi = r.eventi.map((e) => classificaEvento(d.dc, e, self)).filter((e): e is EventoDc => e !== null);
    let nuovi = 0;
    let aperti = 0;
    db.transaction(() => {
      for (const e of eventi) {
        // Solo i record mai visti vanno in coda: rilette, le occorrenze salirebbero due volte.
        if (salvaEventiDc(db, [e]) === 0) continue;
        nuovi++;
        // Login e logout riusciti restano nella pagina del dominio: non sono allarmi.
        if (eAllarme(e.categoria) && upsertAlertEvent(db, comeAlert(e)).created) aperti++;
      }
      scriviLetturaRiuscita(db, d.dc, { record: prossimo.record, eventi: eventi.length, persi: prossimo.persi });
    })();
    return { dc: d.dc, ok: true, eventi: eventi.length, nuovi, persi: prossimo.persi, aperti };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    scriviLetturaFallita(db, d.dc, msg);
    return { dc: d.dc, ok: false, eventi: 0, nuovi: 0, persi: 0, errore: msg, aperti: 0 };
  }
}

export async function giroEventiDc(db: Database, opz: { esegui?: EseguiWinrm; wazuh?: boolean } = {}): Promise<EsitoGiroDc> {
  ensureEventiDcSchema(db);
  ensureWazuhAlertSchema(db);
  const saltato = motivoPerNonLeggere(modoEventiDc(db), opz.wazuh ?? wazuhLeggeGliAllarmi());
  if (saltato) return { saltato, dc: [], aperti: 0 };
  const elenco = dcDaLeggere(db);
  if (elenco.length === 0) return { saltato: "nessuna integrazione AD con la credenziale WinRM del DC", dc: [], aperti: 0 };
  const self = collectSelfIdentity(db);
  const esiti: EsitoDc[] = [];
  let aperti = 0;
  // Un DC alla volta: il carico sul cliente resta quello di una sessione WinRM.
  for (const d of elenco) {
    const { aperti: a, ...esito } = await leggiUnDc(db, d, opz.esegui ?? runWinrmCommand, self);
    aperti += a;
    esiti.push(esito);
  }
  eliminaEventiDcVecchi(db);
  return { saltato: null, dc: esiti, aperti };
}
