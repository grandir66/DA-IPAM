/**
 * «Importa da Active Directory» (piano 2026-10-23-assegnatari-da-ad, passo 5; tavola ⑤-⑪): anteprima con l'esito per
 * utente e importazione dei selezionati. Si propongono le persone (abilitate, con nome e cognome, accesso recente,
 * niente account di servizio o amministrativi); gli altri finiscono negli esclusi col motivo. L'importazione crea o
 * aggiorna solo assegnatari, legati all'utente per objectGUID: **non tocca gli asset**.
 */
import type Database from "better-sqlite3";
import { eAccountDiServizio, eAccountDiSistema, eNomeAmministrativo, inGruppoPrivilegiato } from "./account";
import { pcDegliAccount } from "./db";

export interface FiltriImport {
  soloAbilitati: boolean;
  conNomeCognome: boolean;
  /** Ultimo accesso negli ultimi N giorni; null = sempre. */
  giorniAccesso: number | null;
  /** Unità organizzativa esatta (`ad_users.ou`); null = tutte. */
  ou: string | null;
}

export type EsitoImport = "nuovo" | "aggiorna" | "controlla" | "invariato";
export type MotivoEsclusione = "servizio" | "amministrativo" | "disattivato" | "senza_nome" | "inattivo";

export interface RigaImport {
  chiave: string;
  account: string;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  reparto: string | null;
  ruolo: string | null;
  ultimoAccesso: string | null;
  pc: string[];
  esito: EsitoImport;
  dettaglio: string;
}

export interface Anteprima {
  integrazioni: Array<{ id: number; nome: string; dominio: string; lettoIl: string | null }>;
  ou: string[];
  contatori: Record<EsitoImport, number> & { esclusi: number };
  esclusi: Array<{ motivo: MotivoEsclusione; n: number; esempi: string[] }>;
  righe: RigaImport[];
  totale: number;
  pagina: number;
  perPagina: number;
  /** Le chiavi spuntate di serie (nuovi e da aggiornare), su tutte le pagine. */
  selezionatiDiSerie: string[];
  /** L'esito di ogni proposto, su tutte le pagine: il riepilogo conta «da creare» e «da aggiornare» della selezione. */
  esiti: Record<string, EsitoImport>;
}

interface UtenteAd {
  integration_id: number;
  object_guid: string;
  sam_account_name: string;
  display_name: string | null;
  given_name: string | null;
  surname: string | null;
  email: string | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  ou: string | null;
  enabled: number;
  last_logon_at: string | null;
  raw_data: string | null;
}

interface Assegnatario {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  cellulare: string | null;
  reparto: string | null;
  ruolo: string | null;
  ad_integration_id: number | null;
  ad_object_guid: string | null;
}

export const chiaveUtente = (u: { integration_id: number; object_guid: string }): string => `${u.integration_id}:${u.object_guid}`;
const minuscolo = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

function nomeCognome(u: UtenteAd): { nome: string | null; cognome: string | null } {
  if (u.given_name?.trim() || u.surname?.trim()) return { nome: u.given_name?.trim() || null, cognome: u.surname?.trim() || null };
  // Senza givenName/sn: il nome visualizzato «Mario Rossi» si spezza alla prima parola.
  const parti = (u.display_name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parti.length >= 2) return { nome: parti[0], cognome: parti.slice(1).join(" ") };
  return { nome: parti[0] ?? null, cognome: null };
}

export function nomeAssegnatario(u: UtenteAd): string {
  const { nome, cognome } = nomeCognome(u);
  return [nome, cognome].filter(Boolean).join(" ") || u.display_name?.trim() || u.sam_account_name;
}

function memberOf(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { memberOf?: unknown }).memberOf ?? null;
  } catch {
    return null;
  }
}

/** Perché un utente non si propone, o null. L'ordine conta: il primo motivo che vale è quello che si mostra. */
function motivoEsclusione(u: UtenteAd, f: FiltriImport, oggi: Date): MotivoEsclusione | null {
  const a = u.sam_account_name.toLowerCase();
  if (eAccountDiSistema(a) || eAccountDiServizio(a)) return "servizio";
  if (eNomeAmministrativo(a) || inGruppoPrivilegiato(memberOf(u.raw_data))) return "amministrativo";
  if (f.soloAbilitati && u.enabled !== 1) return "disattivato";
  const { nome, cognome } = nomeCognome(u);
  if (f.conNomeCognome && !nome && !cognome) return "senza_nome";
  if (f.giorniAccesso !== null) {
    const t = u.last_logon_at ? Date.parse(u.last_logon_at.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(u.last_logon_at) ? "" : "Z")) : NaN;
    if (!Number.isFinite(t) || oggi.getTime() - t > f.giorniAccesso * 86_400_000) return "inattivo";
  }
  return null;
}

function confronta(u: UtenteAd, a: Assegnatario): string[] {
  const cambia: string[] = [];
  if (minuscolo(a.name) !== minuscolo(nomeAssegnatario(u))) cambia.push("il nome");
  if (u.email && minuscolo(a.email) !== minuscolo(u.email)) cambia.push("la mail");
  if (u.department && (a.reparto ?? "") !== u.department) cambia.push("il reparto");
  if (u.title && (a.ruolo ?? "") !== u.title) cambia.push("il ruolo");
  if (u.phone && (a.phone ?? "") !== u.phone) cambia.push("il telefono");
  if (u.mobile && (a.cellulare ?? "") !== u.mobile) cambia.push("il cellulare");
  return cambia;
}

function elencoParole(v: string[]): string {
  return v.length <= 1 ? v.join("") : `${v.slice(0, -1).join(", ")} e ${v[v.length - 1]}`;
}

function esitoDi(u: UtenteAd, assegnatari: Assegnatario[]): { esito: EsitoImport; dettaglio: string } {
  const perGuid = assegnatari.find((a) => a.ad_integration_id === u.integration_id && a.ad_object_guid === u.object_guid);
  if (perGuid) {
    const c = confronta(u, perGuid);
    return c.length > 0 ? { esito: "aggiorna", dettaglio: `Già presente: cambia ${elencoParole(c)}` } : { esito: "invariato", dettaglio: "Già presente, invariato" };
  }
  const perMail = u.email ? assegnatari.find((a) => !a.ad_object_guid && minuscolo(a.email) === minuscolo(u.email)) : undefined;
  if (perMail) return { esito: "aggiorna", dettaglio: `Già presente (stessa mail): si collega ad AD` };
  const { cognome } = nomeCognome(u);
  const manca = [!cognome ? "cognome" : null, !u.email ? "mail" : null].filter((x): x is string => !!x);
  if (manca.length > 0) return { esito: "controlla", dettaglio: `Manca ${manca.join(" e ")}` };
  if (assegnatari.some((a) => minuscolo(a.name) === minuscolo(nomeAssegnatario(u)))) return { esito: "controlla", dettaglio: "Omonimo di un assegnatario" };
  return { esito: "nuovo", dettaglio: "Nuovo" };
}

const ORDINE: Record<EsitoImport, number> = { nuovo: 0, aggiorna: 1, controlla: 2, invariato: 3 };
const ESEMPI = 6;

export function anteprimaImport(db: Database.Database, f: FiltriImport, pagina: number, perPagina: number, oggi = new Date()): Anteprima {
  const integrazioni = (db.prepare("SELECT id, name, domain, last_sync_at FROM ad_integrations ORDER BY id").all() as Array<{ id: number; name: string; domain: string; last_sync_at: string | null }>)
    .map((i) => ({ id: i.id, nome: i.name, dominio: i.domain, lettoIl: i.last_sync_at }));
  const utenti = db.prepare(
    `SELECT integration_id, object_guid, sam_account_name, display_name, given_name, surname, email, department, title, phone, mobile, ou,
            enabled, last_logon_at, raw_data
     FROM ad_users ORDER BY lower(COALESCE(surname, display_name, sam_account_name)), lower(COALESCE(given_name, ''))`,
  ).all() as UtenteAd[];
  const ou = [...new Set(utenti.map((u) => u.ou).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const assegnatari = db.prepare(
    "SELECT id, name, email, phone, cellulare, reparto, ruolo, ad_integration_id, ad_object_guid FROM asset_assignees",
  ).all() as Assegnatario[];

  const esclusi = new Map<MotivoEsclusione, { n: number; esempi: string[] }>();
  const proposti: Array<{ u: UtenteAd; esito: EsitoImport; dettaglio: string }> = [];
  for (const u of utenti) {
    if (f.ou && u.ou !== f.ou) continue;
    const m = motivoEsclusione(u, f, oggi);
    if (m) {
      const e = esclusi.get(m) ?? { n: 0, esempi: [] };
      e.n++;
      if (e.esempi.length < ESEMPI) e.esempi.push(u.sam_account_name);
      esclusi.set(m, e);
      continue;
    }
    proposti.push({ u, ...esitoDi(u, assegnatari) });
  }
  proposti.sort((a, b) => ORDINE[a.esito] - ORDINE[b.esito]);

  const contatori = { nuovo: 0, aggiorna: 0, controlla: 0, invariato: 0, esclusi: 0 };
  for (const p of proposti) contatori[p.esito]++;
  for (const e of esclusi.values()) contatori.esclusi += e.n;

  const da = (pagina - 1) * perPagina;
  const fetta = proposti.slice(da, da + perPagina);
  const pc = pcDegliAccount(db, fetta.map((p) => p.u.sam_account_name.toLowerCase()), 30);
  return {
    integrazioni,
    ou,
    contatori,
    esclusi: [...esclusi.entries()].map(([motivo, e]) => ({ motivo, ...e })).sort((a, b) => b.n - a.n),
    righe: fetta.map(({ u, esito, dettaglio }) => {
      const { nome, cognome } = nomeCognome(u);
      return {
        chiave: chiaveUtente(u), account: u.sam_account_name, nome, cognome, email: u.email, reparto: u.department, ruolo: u.title,
        ultimoAccesso: u.last_logon_at, pc: pc.get(u.sam_account_name.toLowerCase()) ?? [], esito, dettaglio,
      };
    }),
    totale: proposti.length,
    pagina,
    perPagina,
    selezionatiDiSerie: proposti.filter((p) => p.esito === "nuovo" || p.esito === "aggiorna").map((p) => chiaveUtente(p.u)),
    esiti: Object.fromEntries(proposti.map((p) => [chiaveUtente(p.u), p.esito])),
  };
}

/**
 * Crea o aggiorna l'assegnatario di un utente di AD e restituisce il suo id: prima per objectGUID, poi per mail fra gli
 * assegnatari non ancora legati, altrimenti uno nuovo. Va chiamata dentro una transazione di chi la usa.
 */
export function assegnatarioDaUtente(db: Database.Database, u: UtenteAd): { id: number; creato: boolean } {
  const { nome, cognome } = nomeCognome(u);
  const valori = [nomeAssegnatario(u), nome, cognome, u.email, u.phone, u.mobile, u.department, u.title, u.integration_id, u.object_guid, u.enabled];
  const perGuid = db.prepare("SELECT id FROM asset_assignees WHERE ad_integration_id = ? AND ad_object_guid = ?").get(u.integration_id, u.object_guid) as { id: number } | undefined;
  const perMail = !perGuid && u.email
    ? db.prepare("SELECT id FROM asset_assignees WHERE ad_object_guid IS NULL AND lower(email) = lower(?) ORDER BY id LIMIT 1").get(u.email) as { id: number } | undefined
    : undefined;
  const esistente = perGuid ?? perMail;
  if (esistente) {
    db.prepare(
      `UPDATE asset_assignees SET name = ?, nome = ?, cognome = ?, email = COALESCE(?, email), phone = COALESCE(?, phone), cellulare = ?,
         reparto = ?, ruolo = ?, ad_integration_id = ?, ad_object_guid = ?, ad_abilitato = ?, origine = 'ad',
         ad_disattivato_il = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(ad_disattivato_il, datetime('now')) END, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(...valori, u.enabled, esistente.id);
    return { id: esistente.id, creato: false };
  }
  const r = db.prepare(
    `INSERT INTO asset_assignees (name, nome, cognome, email, phone, cellulare, reparto, ruolo, ad_integration_id, ad_object_guid, ad_abilitato, origine,
       ad_disattivato_il)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ad', CASE WHEN ? = 1 THEN NULL ELSE datetime('now') END)`,
  ).run(...valori, u.enabled);
  return { id: Number(r.lastInsertRowid), creato: true };
}

const SELECT_UTENTE = `SELECT integration_id, object_guid, sam_account_name, display_name, given_name, surname, email, department, title, phone, mobile,
  ou, enabled, last_logon_at, raw_data FROM ad_users`;

export function utenteAdPerChiave(db: Database.Database, chiave: string): UtenteAd | undefined {
  const m = /^(\d+):(.+)$/.exec(chiave);
  if (!m) return undefined;
  return db.prepare(`${SELECT_UTENTE} WHERE integration_id = ? AND object_guid = ?`).get(Number(m[1]), m[2]) as UtenteAd | undefined;
}

export function utenteAdPerAccount(db: Database.Database, account: string): UtenteAd | undefined {
  return db.prepare(`${SELECT_UTENTE} WHERE lower(sam_account_name) = lower(?) ORDER BY enabled DESC, integration_id LIMIT 1`).get(account) as UtenteAd | undefined;
}

/** Importa i selezionati in UNA transazione. Le chiavi che non corrispondono a un utente si contano e si saltano. */
export function importaDaAd(db: Database.Database, chiavi: readonly string[]): { creati: number; aggiornati: number; saltati: number } {
  const esito = { creati: 0, aggiornati: 0, saltati: 0 };
  db.transaction(() => {
    for (const k of new Set(chiavi)) {
      const u = utenteAdPerChiave(db, k);
      if (!u) {
        esito.saltati++;
        continue;
      }
      if (assegnatarioDaUtente(db, u).creato) esito.creati++;
      else esito.aggiornati++;
    }
  })();
  return esito;
}
