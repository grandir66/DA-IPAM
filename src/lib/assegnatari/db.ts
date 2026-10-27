/**
 * Letture e scritture degli assegnatari da AD (piano 2026-10-23-assegnatari-da-ad). Ogni funzione riceve il DB del
 * cliente: le rotte passano quello del contesto (`getDb()`), il giro orario quello di ogni cliente (`getTenantDb`), le
 * prove un `:memory:`. Chi chiama controlla prima `schemaAssegnatariAdPresente`.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { inGruppoPrivilegiato } from "./account";
import { SOGLIE_DI_SERIE, type AccessoAggregato, type FonteAccesso, type PersonaAd, type Soglie } from "./proposta";

/** Il DB del cliente del contesto (rotte dentro `withTenantFromSession`, sync AD): senza contesto è un errore, mai DEFAULT. */
export function dbCliente(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto del cliente per gli assegnatari");
  return getTenantDb(code);
}

// ── Impostazioni del cliente ─────────────────────────────────────────────────

export const CHIAVE_GIRO_ACCESO = "assegnatari.giro_accessi";
export const CHIAVE_CURSORE_WAZUH = "assegnatari.cursore_wazuh";
export const CHIAVE_ULTIMO_GIRO = "assegnatari.ultimo_giro";
export const CHIAVI_SOGLIE = {
  percentuale: "assegnatari.soglia_percentuale",
  minimo: "assegnatari.minimo_accessi",
  giorni: "assegnatari.finestra_giorni",
} as const;
export const LIMITI_SOGLIE = {
  percentuale: { min: 50, max: 95 },
  minimo: { min: 1, max: 100 },
  giorni: { min: 7, max: 90 },
} as const;
/** Le righe degli accessi più vecchie di così si cancellano a ogni giro. */
export const GIORNI_CONSERVAZIONE = 90;

function leggiImpostazione(db: Database.Database, chiave: string): string | null {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(chiave) as { value: string } | undefined;
  return r?.value ?? null;
}

export function scriviImpostazione(db: Database.Database, chiave: string, valore: string): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(chiave, valore);
}

/** L'esito dell'ultimo giro (scritto da `job.ts`), o null se non ha mai girato o è illeggibile. */
export function ultimoGiroAccessi(db: Database.Database): { il: string; ok: boolean; testo: string } | null {
  const t = leggiImpostazione(db, CHIAVE_ULTIMO_GIRO);
  if (!t) return null;
  try {
    const o = JSON.parse(t) as { il?: unknown; ok?: unknown; testo?: unknown };
    if (typeof o.il !== "string" || typeof o.ok !== "boolean" || typeof o.testo !== "string") return null;
    return { il: o.il, ok: o.ok, testo: o.testo };
  } catch {
    return null;
  }
}

/** Il giro orario degli accessi: spento salvo «1» scritto da Opzioni (nasce spento, decisione del piano). */
export function giroAccessiAcceso(db: Database.Database): boolean {
  return leggiImpostazione(db, CHIAVE_GIRO_ACCESO) === "1";
}

/** Le soglie del cliente; una chiave assente o illeggibile vale quella di serie, una fuori misura si riporta ai limiti. */
export function soglieDelCliente(db: Database.Database): Soglie {
  const uno = (k: keyof typeof CHIAVI_SOGLIE): number => {
    const n = parseInt(leggiImpostazione(db, CHIAVI_SOGLIE[k]) ?? "", 10);
    if (Number.isNaN(n)) return SOGLIE_DI_SERIE[k];
    return Math.min(LIMITI_SOGLIE[k].max, Math.max(LIMITI_SOGLIE[k].min, n));
  };
  return { percentuale: uno("percentuale"), minimo: uno("minimo"), giorni: uno("giorni") };
}

// ── Accessi ──────────────────────────────────────────────────────────────────

export interface RigaAccesso {
  hostId: number;
  account: string;
  fonte: FonteAccesso;
  /** «YYYY-MM-DD» (UTC). */
  giorno: string;
  conteggio: number;
  ultimo: string | null;
}

/**
 * Scrive le righe in una transazione. `somma`: il conteggio si aggiunge (Wazuh: finestre che non si sovrappongono);
 * `presenza`: una riga per giorno vale 1 accesso, una seconda osservazione aggiorna solo l'ora (WinRM, GLPI).
 */
export function registraAccessi(db: Database.Database, righe: readonly RigaAccesso[], modo: "somma" | "presenza"): number {
  if (righe.length === 0) return 0;
  const conflitto = modo === "somma"
    ? "conteggio = conteggio + excluded.conteggio"
    : "conteggio = MAX(conteggio, excluded.conteggio)";
  const st = db.prepare(
    `INSERT INTO host_accessi_utente (host_id, account, fonte, giorno, conteggio, ultimo) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(host_id, account, fonte, giorno) DO UPDATE SET ${conflitto},
       ultimo = CASE WHEN excluded.ultimo IS NOT NULL AND (ultimo IS NULL OR excluded.ultimo > ultimo) THEN excluded.ultimo ELSE ultimo END`,
  );
  db.transaction(() => {
    for (const r of righe) st.run(r.hostId, r.account, r.fonte, r.giorno, modo === "somma" ? r.conteggio : 1, r.ultimo);
  })();
  return righe.length;
}

export function pulisciAccessi(db: Database.Database, giorni = GIORNI_CONSERVAZIONE): number {
  return db.prepare("DELETE FROM host_accessi_utente WHERE giorno < date('now', ?)").run(`-${giorni} days`).changes;
}

/** Gli accessi a un host nella finestra, sommati per account e fonte. */
export function accessiHost(db: Database.Database, hostId: number, giorni: number): AccessoAggregato[] {
  return db.prepare(
    `SELECT account, fonte, SUM(conteggio) AS conteggio, MAX(ultimo) AS ultimo
     FROM host_accessi_utente WHERE host_id = ? AND giorno >= date('now', ?)
     GROUP BY account, fonte`,
  ).all(hostId, `-${giorni} days`) as AccessoAggregato[];
}

/** Per ogni account, i PC dove si collega di più nella finestra (al massimo `quanti`), col nome che si mostra. */
export function pcDegliAccount(db: Database.Database, account: readonly string[], giorni: number, quanti = 2): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < account.length; i += 500) {
    const parte = account.slice(i, i + 500);
    if (parte.length === 0) continue;
    const righe = db.prepare(
      `SELECT a.account, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, ''), h.ip) AS nome, h.ip, SUM(a.conteggio) AS n
       FROM host_accessi_utente a JOIN hosts h ON h.id = a.host_id
       WHERE a.giorno >= date('now', ?) AND a.account IN (${parte.map(() => "?").join(",")})
       GROUP BY a.account, a.host_id ORDER BY a.account, n DESC`,
    ).all(`-${giorni} days`, ...parte) as Array<{ account: string; nome: string; ip: string; n: number }>;
    for (const r of righe) {
      const l = out.get(r.account) ?? [];
      // «DA-PROTECT.domarc.it» → «DA-PROTECT»: i nomi completi allargavano la tabella fino a nascondere l'esito (hub .8, 23/10).
      const breve = r.nome === r.ip ? r.nome : r.nome.split(".")[0] || r.nome;
      if (l.length < quanti) l.push(breve);
      out.set(r.account, l);
    }
  }
  return out;
}

// ── Persone di AD ────────────────────────────────────────────────────────────

interface RigaAdUser {
  integration_id: number;
  object_guid: string;
  account: string;
  display_name: string | null;
  given_name: string | null;
  surname: string | null;
  department: string | null;
  title: string | null;
  enabled: number;
  raw_data: string | null;
}

function memberOf(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { memberOf?: unknown }).memberOf ?? null;
  } catch {
    return null;
  }
}

function aPersona(r: RigaAdUser): PersonaAd {
  return {
    account: r.account,
    integrationId: r.integration_id,
    guid: r.object_guid,
    nome: r.given_name,
    cognome: r.surname,
    nomeVisualizzato: r.display_name,
    reparto: r.department,
    ruolo: r.title,
    abilitato: r.enabled === 1,
    amministrativo: inGruppoPrivilegiato(memberOf(r.raw_data)),
  };
}

/** Le persone di AD per account (sAMAccountName in minuscolo). Con più integrazioni vince la prima abilitata. */
export function personeAd(db: Database.Database, account: readonly string[]): Map<string, PersonaAd> {
  const out = new Map<string, PersonaAd>();
  for (let i = 0; i < account.length; i += 500) {
    const parte = account.slice(i, i + 500);
    if (parte.length === 0) continue;
    const righe = db.prepare(
      `SELECT integration_id, object_guid, lower(sam_account_name) AS account, display_name, given_name, surname, department,
              title, enabled, raw_data
       FROM ad_users WHERE lower(sam_account_name) IN (${parte.map(() => "?").join(",")})
       ORDER BY enabled DESC, integration_id`,
    ).all(...parte) as RigaAdUser[];
    for (const r of righe) if (!out.has(r.account)) out.set(r.account, aPersona(r));
  }
  return out;
}

// ── Allineamento dopo la sync di AD (passo 2) ────────────────────────────────

export interface CampiAdInPiu {
  given_name: string | null;
  surname: string | null;
  mobile: string | null;
  company: string | null;
  manager_dn: string | null;
  employee_id: string | null;
  office: string | null;
}

/** Gli attributi in più dell'utente appena scritto da `upsertAdUser` (colonne della migrazione, a parte). */
export function scriviCampiAdUtente(db: Database.Database, integrationId: number, guid: string, c: CampiAdInPiu): void {
  db.prepare(
    `UPDATE ad_users SET given_name = ?, surname = ?, mobile = ?, company = ?, manager_dn = ?, employee_id = ?, office = ?
     WHERE integration_id = ? AND object_guid = ?`,
  ).run(c.given_name, c.surname, c.mobile, c.company, c.manager_dn, c.employee_id, c.office, integrationId, guid);
}

/**
 * Gli assegnatari legati a un utente di AD riprendono i dati da AD (nome, mail, reparto, ruolo, telefoni) e lo stato;
 * `ad_disattivato_il` si scrive la prima volta che l'utente risulta disattivato e si toglie se torna attivo. Un utente
 * che non c'è più nella tabella non tocca il suo assegnatario. Restituisce quanti assegnatari ha aggiornato.
 */
export function allineaAssegnatariDaAd(db: Database.Database, integrationId: number): number {
  return db.prepare(
    `UPDATE asset_assignees SET
       name = COALESCE(NULLIF(trim(COALESCE(u.given_name, '') || ' ' || COALESCE(u.surname, '')), ''), u.display_name, asset_assignees.name),
       nome = u.given_name,
       cognome = u.surname,
       email = COALESCE(u.email, asset_assignees.email),
       phone = COALESCE(u.phone, asset_assignees.phone),
       cellulare = u.mobile,
       reparto = u.department,
       ruolo = u.title,
       ad_abilitato = u.enabled,
       ad_disattivato_il = CASE WHEN u.enabled = 1 THEN NULL ELSE COALESCE(asset_assignees.ad_disattivato_il, datetime('now')) END,
       updated_at = datetime('now')
     FROM ad_users u
     WHERE asset_assignees.ad_integration_id = ? AND u.integration_id = asset_assignees.ad_integration_id
       AND u.object_guid = asset_assignees.ad_object_guid`,
  ).run(integrationId).changes;
}

// ── Elenco degli assegnatari (tavola ①-④) ────────────────────────────────────

export interface RigaElencoAssegnatari {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  reparto: string | null;
  ruolo: string | null;
  origine: string;
  ad_abilitato: number | null;
  ad_disattivato_il: string | null;
  asset: number;
}

export interface ElencoAssegnatari {
  righe: RigaElencoAssegnatari[];
  totale: number;
  pagina: number;
  perPagina: number;
  /** Assegnatari disattivati in AD che hanno ancora asset, e quanti asset (avviso ②). */
  usciti: { assegnatari: number; asset: number };
  /** Per gli usciti di questa pagina: i loro asset, per «Riassegna» (id assegnatario → asset). */
  assetDegliUsciti: Record<number, Array<{ id: number; nome: string }>>;
}

export function elencoAssegnatari(db: Database.Database, f: { origine: "ad" | "manuale" | null; cerca: string | null; soloUsciti: boolean; pagina: number; perPagina: number }): ElencoAssegnatari {
  const dove: string[] = [];
  const par: unknown[] = [];
  if (f.origine) {
    dove.push("a.origine = ?");
    par.push(f.origine);
  }
  if (f.cerca?.trim()) {
    const s = `%${f.cerca.trim()}%`;
    dove.push("(a.name LIKE ? OR a.email LIKE ? OR a.reparto LIKE ? OR a.ruolo LIKE ?)");
    par.push(s, s, s, s);
  }
  if (f.soloUsciti) dove.push("a.ad_disattivato_il IS NOT NULL AND EXISTS (SELECT 1 FROM inventory_assets i WHERE i.asset_assignee_id = a.id)");
  const where = dove.length ? `WHERE ${dove.join(" AND ")}` : "";
  const totale = (db.prepare(`SELECT COUNT(*) AS n FROM asset_assignees a ${where}`).get(...par) as { n: number }).n;
  const righe = db.prepare(
    `SELECT a.id, a.name, a.email, a.phone, a.note, a.reparto, a.ruolo, a.origine, a.ad_abilitato, a.ad_disattivato_il,
            COALESCE(c.n, 0) AS asset
     FROM asset_assignees a
     LEFT JOIN (SELECT asset_assignee_id, COUNT(*) AS n FROM inventory_assets WHERE asset_assignee_id IS NOT NULL GROUP BY asset_assignee_id) c
       ON c.asset_assignee_id = a.id
     ${where}
     ORDER BY (a.ad_disattivato_il IS NOT NULL AND COALESCE(c.n, 0) > 0) DESC, lower(a.name)
     LIMIT ? OFFSET ?`,
  ).all(...par, f.perPagina, (f.pagina - 1) * f.perPagina) as RigaElencoAssegnatari[];
  const usciti = db.prepare(
    `SELECT COUNT(DISTINCT a.id) AS assegnatari, COUNT(i.id) AS asset
     FROM asset_assignees a JOIN inventory_assets i ON i.asset_assignee_id = a.id
     WHERE a.ad_disattivato_il IS NOT NULL`,
  ).get() as { assegnatari: number; asset: number };
  const assetDegliUsciti: Record<number, Array<{ id: number; nome: string }>> = {};
  const idUsciti = righe.filter((r) => r.ad_disattivato_il && r.asset > 0).map((r) => r.id);
  if (idUsciti.length > 0) {
    const asset = db.prepare(
      `SELECT asset_assignee_id AS a, id, COALESCE(NULLIF(hostname, ''), NULLIF(nome_prodotto, ''), NULLIF(asset_tag, ''), 'Asset ' || id) AS nome
       FROM inventory_assets WHERE asset_assignee_id IN (${idUsciti.map(() => "?").join(",")}) ORDER BY nome`,
    ).all(...idUsciti) as Array<{ a: number; id: number; nome: string }>;
    for (const x of asset) (assetDegliUsciti[x.a] ??= []).push({ id: x.id, nome: x.nome });
  }
  return { righe, totale, pagina: f.pagina, perPagina: f.perPagina, usciti, assetDegliUsciti };
}
