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
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { accessoWinrmDaAccountAdDb, accessoWinrmDelDcDb } from "@/lib/ad/credenziale-ldap";
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
import { classificaEvento, comeAlert, eAllarme, leggiRispostaDc, prossimoCursore, scriptEventiDc, type EventoDc, type EventoGrezzo } from "./eventi";
import type { CursoriAltri } from "./db";

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
  /** «winrm»: la voce WinRM dell'integrazione; «ad»: senza voce WinRM, l'account LDAP dell'integrazione. */
  fonte: "winrm" | "ad";
}

/** DC scelti a mano (elenco di nomi in minuscolo, JSON); assente = scelta automatica. */
export const CHIAVE_DC_SCELTI = "eventi_dc.dc_scelti";
/** Fino a questi DC si leggono tutti da soli; oltre, solo quello dell'integrazione finché non si sceglie. */
export const MAX_DC_AUTOMATICI = 5;

/** null = nessuna scelta salvata. Un valore guasto vale come nessuna scelta. */
export function dcScelti(db: Database): Set<string> | null {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_DC_SCELTI) as { value: string } | undefined;
  if (!r) return null;
  try {
    const v: unknown = JSON.parse(r.value);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase())) : null;
  } catch {
    return null;
  }
}

/** Salva la scelta; null torna alla scelta automatica. */
export function scriviDcScelti(db: Database, nomi: readonly string[] | null): void {
  if (nomi === null) {
    db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(CHIAVE_DC_SCELTI);
    return;
  }
  const valore = JSON.stringify([...new Set(nomi.map((n) => n.toLowerCase()))].sort());
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(CHIAVE_DC_SCELTI, valore);
}

export interface DcDisponibile extends DcDaLeggere {
  /** Il DC scritto nell'integrazione (quello con cui si legge AD). */
  dellIntegrazione: boolean;
  scelto: boolean;
}

/**
 * Tutti i DC che si potrebbero leggere, con la scelta. I DC sono quelli dell'OU «Domain Controllers»
 * di ogni integrazione accesa (per nome DNS, così Kerberos trova il servizio), o il DC
 * dell'integrazione se la sincronizzazione non li ha ancora portati. Si entra con la credenziale
 * WinRM del DC; se manca, con l'account di AD dell'integrazione (03/11/2026: su 70151 AD era letto
 * ma la pagina diceva «0 DC» perché la voce WinRM non c'era).
 *
 * Scelta (70151 ha decine di DC): salvata a mano vale quella; senza, si leggono tutti fino a
 * MAX_DC_AUTOMATICI, oltre solo quello dell'integrazione.
 */
export function dcDisponibili(db: Database): DcDisponibile[] {
  const integrazioni = db
    .prepare(
      `SELECT id, dc_host, domain, winrm_credential_id, credential_id FROM ad_integrations
        WHERE enabled = 1 AND (winrm_credential_id IS NOT NULL OR credential_id IS NOT NULL) ORDER BY id`,
    )
    .all() as Array<{ id: number; dc_host: string; domain: string; winrm_credential_id: number | null; credential_id: number | null }>;
  const tutti: Array<Omit<DcDisponibile, "scelto">> = [];
  const visti = new Set<string>();
  const perIntegrazione = db.prepare(
    `SELECT dns_host_name, sam_account_name FROM ad_computers
      WHERE integration_id = ? AND enabled = 1 AND distinguished_name LIKE '%OU=Domain Controllers,%' COLLATE NOCASE
      ORDER BY dns_host_name`,
  );
  for (const i of integrazioni) {
    const fonte = i.winrm_credential_id != null ? "winrm" : "ad";
    const credentialId = (i.winrm_credential_id ?? i.credential_id) as number;
    const host = i.dc_host.trim().toLowerCase();
    const nomi = (perIntegrazione.all(i.id) as Array<{ dns_host_name: string | null; sam_account_name: string }>)
      .map((c) => (c.dns_host_name ?? "").trim() || c.sam_account_name.replace(/\$$/, ""))
      .filter(Boolean);
    for (const dc of nomi.length ? nomi : [i.dc_host]) {
      const k = dc.toLowerCase();
      if (visti.has(k)) continue;
      visti.add(k);
      const dellIntegrazione = k === host || k.split(".")[0] === host.split(".")[0];
      tutti.push({ integrationId: i.id, dc, realm: i.domain, credentialId, fonte, dellIntegrazione });
    }
  }
  const scelti = dcScelti(db);
  const automatico = (d: Omit<DcDisponibile, "scelto">) => tutti.length <= MAX_DC_AUTOMATICI || d.dellIntegrazione;
  const out = tutti.map((d) => ({ ...d, scelto: scelti ? scelti.has(d.dc.toLowerCase()) : automatico(d) }));
  // Oltre la soglia e nessun DC riconosciuto come quello dell'integrazione: il primo, per non leggere niente in silenzio.
  if (!scelti && out.length > 0 && !out.some((d) => d.scelto)) out[0]!.scelto = true;
  return out;
}

/** I DC da leggere: quelli scelti. */
export function dcDaLeggere(db: Database): DcDaLeggere[] {
  return dcDisponibili(db)
    .filter((d) => d.scelto)
    .map(({ integrationId, dc, realm, credentialId, fonte }) => ({ integrationId, dc, realm, credentialId, fonte }));
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

/** Risoluzione del nome del DC (sostituibile nelle prove). */
export type RisolviNome = (nome: string) => Promise<void>;

const risolviConIlSistema: RisolviNome = async (nome) => {
  if (isIP(nome)) return;
  await lookup(nome);
};

/**
 * Il nome del DC deve risolversi dal DNS della VM: Kerberos ne ha bisogno e non si può ripiegare
 * sull'IP. Su 70151 (03/11/2026) il DNS della VM non conosceva il dominio AD e l'errore usciva come
 * «TCP_TIMEOUT» sulle porte WinRM, che portava a cercare un firewall inesistente.
 */
async function controllaNome(dc: string, realm: string, risolvi: RisolviNome): Promise<void> {
  try {
    await risolvi(dc);
  } catch {
    throw new Error(
      `il nome ${dc} non si risolve dal DNS di questa macchina: il DNS deve conoscere il dominio ${realm} (di solito si inoltra ${realm} ai DC)`,
    );
  }
}

/** Il comando WinRM (sostituibile nelle prove). */
export type EseguiWinrm = typeof runWinrmCommand;

/** Legge un DC e salva; non lancia: l'errore resta nello stato del DC. */
export async function leggiUnDc(
  db: Database,
  d: DcDaLeggere,
  esegui: EseguiWinrm,
  self = collectSelfIdentity(db),
  risolvi: RisolviNome = risolviConIlSistema,
): Promise<EsitoDc & { aperti: number }> {
  const prima = letturaDc(db, d.dc);
  const cursore = prima?.ultimoRecord ?? null;
  const cursoriAltri = prima?.cursoriAltri ?? {};
  try {
    await controllaNome(d.dc, d.realm, risolvi);
    const accesso = d.fonte === "ad" ? accessoWinrmDaAccountAdDb(db, d.credentialId) : accessoWinrmDelDcDb(db, d.credentialId);
    if (!accesso.ok) throw new Error(accesso.motivo);
    const script = scriptEventiDc({ Security: cursore, ...cursoriAltri });
    const raw = await esegui(d.dc, accesso.port, accesso.username, accesso.password, script, true, d.realm);
    const r = leggiRispostaDc(raw);
    if (r.errore) throw new Error(`il DC non ha dato il registro Sicurezza: ${r.errore}`);
    const prossimo = prossimoCursore(cursore, r);
    // System e Defender non fermano il DC: assente o in errore, il loro cursore resta e si riprova al giro dopo.
    const grezzi: EventoGrezzo[] = [...r.eventi];
    const altri: CursoriAltri = {};
    for (const a of r.altri) {
      if (a.registro === "Security" || a.assente) continue;
      if (a.errore) {
        console.warn(`[eventi-dc] ${d.dc}: registro ${a.registro} non letto: ${a.errore}`);
        continue;
      }
      altri[a.registro] = prossimoCursore(cursoriAltri[a.registro] ?? null, a).record;
      grezzi.push(...a.eventi);
    }
    const eventi = grezzi.map((e) => classificaEvento(d.dc, e, self)).filter((e): e is EventoDc => e !== null);
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
      scriviLetturaRiuscita(db, d.dc, { record: prossimo.record, eventi: eventi.length, persi: prossimo.persi, altri });
    })();
    return { dc: d.dc, ok: true, eventi: eventi.length, nuovi, persi: prossimo.persi, aperti };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    scriviLetturaFallita(db, d.dc, msg);
    return { dc: d.dc, ok: false, eventi: 0, nuovi: 0, persi: 0, errore: msg, aperti: 0 };
  }
}

export async function giroEventiDc(db: Database, opz: { esegui?: EseguiWinrm; wazuh?: boolean; risolvi?: RisolviNome } = {}): Promise<EsitoGiroDc> {
  ensureEventiDcSchema(db);
  ensureWazuhAlertSchema(db);
  const saltato = motivoPerNonLeggere(modoEventiDc(db), opz.wazuh ?? wazuhLeggeGliAllarmi());
  if (saltato) return { saltato, dc: [], aperti: 0 };
  const elenco = dcDaLeggere(db);
  if (elenco.length === 0) {
    const saltato = dcDisponibili(db).length > 0 ? "nessun DC scelto" : "nessuna integrazione AD accesa con un account (né WinRM né AD)";
    return { saltato, dc: [], aperti: 0 };
  }
  const self = collectSelfIdentity(db);
  const esiti: EsitoDc[] = [];
  let aperti = 0;
  // Un DC alla volta: il carico sul cliente resta quello di una sessione WinRM.
  for (const d of elenco) {
    const { aperti: a, ...esito } = await leggiUnDc(db, d, opz.esegui ?? runWinrmCommand, self, opz.risolvi ?? (opz.esegui ? async () => {} : risolviConIlSistema));
    aperti += a;
    esiti.push(esito);
  }
  eliminaEventiDcVecchi(db);
  return { saltato: null, dc: esiti, aperti };
}
