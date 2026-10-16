/**
 * La pulizia dei dati vecchi delle credenziali (tappa 2g, T27 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`): la parte con l'handle.
 * La lancia solo `scripts/credenziali/pulizia-t2.ts`, mai getTenantDb: su
 * un'appliance che riceve `main` conversioni e pulizia girerebbero nella
 * stessa apertura, senza prova a vuoto, backup e conferma.
 *
 * Dal T26 nessuno legge più le fonti vecchie; qui si tolgono i segreti che ci
 * sono rimasti:
 * - `network_devices`: le sei colonne delle credenziali a NULL solo per gli
 *   apparati lasciati accettati da Riccardo (16/10) che hanno già un binding
 *   equivalente (definizione della 2e, `vecchioRimastoApparatiDb`). Un
 *   apparato con una colonna piena fuori dall'elenco, uno accettato con una
 *   colonna senza equivalente o un binding inline bloccano il tenant: dopo la
 *   2e le colonne dovrebbero essere già vuote, e se non lo sono qualcosa non
 *   torna. Le colonne restano nello schema (toglierle vorrebbe dire
 *   ricostruire `network_devices`);
 * - `network_controllers` (`username`, `password_enc`, `api_key_enc`) e
 *   `ad_integrations` (`encrypted_username`, `encrypted_password`) a `''`
 *   (sono NOT NULL), solo dove `credential_id` non è NULL. Le righe senza voce
 *   (Omada lasciate dalla 2f, o voce tolta dopo) restano com'erano e si
 *   elencano;
 * - `DROP TABLE` delle due catene vecchie, due istruzioni (SQLite ne toglie
 *   una per istruzione), nella stessa transazione: se una fallisce torna
 *   indietro tutto;
 * - il segno `credenziali_t2_pulizia`, coi lasciati accettati e i ripieghi
 *   confermati. Con `done:` la pulizia non rifà niente.
 *
 * Modulo con l'handle: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { convertiCredenzialiApparati, type ColonnaApparato, vecchioRimastoApparatiDb } from "./converti-apparati";
import { convertiControllerEAd } from "./converti-integrazioni";
import { TABELLE_CATENE_VECCHIE } from "./converti-catene";
import type { SegniT2, StatoTenant2g } from "./condizioni-2g";
import { leggiSegno, scriviSegno, SEGNO_APPARATI, SEGNO_CATENE, SEGNO_INTEGRAZIONI, SEGNO_PULIZIA, SEGNO_TIPI } from "./segni-t2";

function haTabella(dbh: Database.Database, nome: string): boolean {
  return !!dbh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

function colonneDi(dbh: Database.Database, tabella: string): Set<string> {
  return new Set((dbh.prepare(`PRAGMA table_info(${tabella})`).all() as Array<{ name: string }>).map((r) => r.name));
}

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── Le condizioni, misurate sul DB ──────────────────────────────────────────

export interface MisuraCondizioni {
  stato: StatoTenant2g;
  /** Nomi degli apparati lasciati, per il terminale (mai su file). */
  nomiApparati: Record<number, string>;
  /** Le conversioni a vuoto che non sono riuscite (chiave assente, DB rotto…): bloccano. */
  nonMisurabili: string[];
}

function segni(dbh: Database.Database): SegniT2 {
  if (!haTabella(dbh, "tenant_settings")) return { tipi: null, catene: null, apparati: null, integrazioni: null };
  return {
    tipi: leggiSegno(dbh, SEGNO_TIPI),
    catene: leggiSegno(dbh, SEGNO_CATENE),
    apparati: leggiSegno(dbh, SEGNO_APPARATI),
    integrazioni: leggiSegno(dbh, SEGNO_INTEGRAZIONI),
  };
}

/**
 * Segni del DB così com'è, e i lasciati della 2e e della 2f rifatte a vuoto
 * adesso (dentro una transazione che si annulla): non scrive. È la misura che
 * `valutaCondizioni2g` giudica, per lo script delle condizioni e per la pulizia.
 */
export function misuraCondizioniDb(dbh: Database.Database, tenant: string): MisuraCondizioni {
  const nonMisurabili: string[] = [];
  const stato: StatoTenant2g = { tenant, segni: segni(dbh), lasciatiApparati: [], lasciatiIntegrazioni: [] };
  try {
    stato.lasciatiApparati = convertiCredenzialiApparati(dbh, { aVuoto: true }).lasciati;
  } catch (e) {
    nonMisurabili.push(`conversione degli apparati (2e) a vuoto non riuscita: ${messaggio(e)}`);
  }
  try {
    stato.lasciatiIntegrazioni = convertiControllerEAd(dbh, { aVuoto: true }).lasciati;
  } catch (e) {
    nonMisurabili.push(`conversione di controller e AD (2f) a vuoto non riuscita: ${messaggio(e)}`);
  }
  const nomiApparati: Record<number, string> = {};
  const nome = dbh.prepare("SELECT name FROM network_devices WHERE id = ?");
  for (const l of stato.lasciatiApparati) {
    const r = nome.get(l.device_id) as { name: string } | undefined;
    nomiApparati[l.device_id] = r?.name ?? "?";
  }
  return { stato, nomiApparati, nonMisurabili };
}

/** Il segno della pulizia se è già stata fatta (`done:`), altrimenti null. */
export function puliziaFatta(dbh: Database.Database): string | null {
  if (!haTabella(dbh, "tenant_settings")) return null;
  const v = leggiSegno(dbh, SEGNO_PULIZIA);
  return v != null && v.startsWith("done:") ? v : null;
}

// ── Il piano ────────────────────────────────────────────────────────────────

export interface Riga2g {
  id: number;
  nome: string;
}

export interface PianoPulizia {
  tenant: string;
  /** L'elenco di Riccardo per questo tenant, ordinato (vuoto = nessuno). */
  lasciatiAccettati: number[];
  /** Apparati le cui colonne si svuotano (tutti accettati, con binding equivalente). */
  apparati: Array<{ device_id: number; nome: string; colonne: ColonnaApparato[] }>;
  /** Apparati che bloccano la pulizia del tenant, col perché. */
  bloccanti: Array<{ device_id: number; nome: string; colonne: ColonnaApparato[]; motivo: string }>;
  /** Controller con la voce e colonne non vuote: si svuotano. */
  controller: Riga2g[];
  /** Controller senza voce con colonne non vuote: restano com'erano. */
  controllerSenzaVoce: Riga2g[];
  ad: Riga2g[];
  adSenzaVoce: Riga2g[];
  /** Le tabelle vecchie che ci sono, con le righe: si tolgono. */
  tabelle: Array<{ nome: string; righe: number }>;
}

const COLONNE_CONTROLLER = ["username", "password_enc", "api_key_enc"] as const;
const COLONNE_AD = ["encrypted_username", "encrypted_password"] as const;

/** Righe con la voce (o senza) e colonne non vuote. Una tabella senza `credential_id` non ha passato la 2f: errore. */
function righeIntegrazione(dbh: Database.Database, tabella: "network_controllers" | "ad_integrations", colonne: readonly string[]): { con: Riga2g[]; senza: Riga2g[] } {
  if (!haTabella(dbh, tabella)) return { con: [], senza: [] };
  const presenti = colonneDi(dbh, tabella);
  if (!presenti.has("credential_id")) throw new Error(`${tabella} non ha la colonna credential_id: la 2f non è passata su questo DB`);
  const piene = colonne.filter((c) => presenti.has(c)).map((c) => `COALESCE(${c}, '') != ''`).join(" OR ") || "0";
  const righe = dbh.prepare(`SELECT id, name, credential_id FROM ${tabella} WHERE ${piene} ORDER BY id`).all() as Array<{ id: number; name: string; credential_id: number | null }>;
  return {
    con: righe.filter((r) => r.credential_id != null).map((r) => ({ id: r.id, nome: r.name })),
    senza: righe.filter((r) => r.credential_id == null).map((r) => ({ id: r.id, nome: r.name })),
  };
}

/**
 * Cosa farebbe la pulizia su questo DB, senza scrivere. `accettati`:
 * l'elenco di Riccardo per QUESTO tenant (vuoto se non ce n'è). Lancia solo su
 * un guasto vero (chiave assente o sbagliata, tabelle senza le colonne della 2f).
 */
export function pianoPuliziaDb(dbh: Database.Database, tenant: string, accettati: readonly number[]): PianoPulizia {
  const elenco = [...new Set(accettati)].sort((a, b) => a - b);
  const piano: PianoPulizia = {
    tenant,
    lasciatiAccettati: elenco,
    apparati: [],
    bloccanti: [],
    controller: [],
    controllerSenzaVoce: [],
    ad: [],
    adSenzaVoce: [],
    tabelle: [],
  };
  for (const v of vecchioRimastoApparatiDb(dbh)) {
    if (!elenco.includes(v.device_id)) {
      const perche = v.senzaEquivalente ?? "con binding equivalente, ma dopo la 2e dovevano essere già vuote";
      const cosa = v.colonne.length > 0 ? `colonne piene (${v.colonne.join(", ")})` : "fonti vecchie";
      piano.bloccanti.push({ device_id: v.device_id, nome: v.nome, colonne: v.colonne, motivo: `${cosa} fuori dai lasciati accettati: ${perche}` });
    } else if (v.senzaEquivalente != null) {
      piano.bloccanti.push({ device_id: v.device_id, nome: v.nome, colonne: v.colonne, motivo: v.senzaEquivalente });
    } else if (v.colonne.length > 0) {
      piano.apparati.push({ device_id: v.device_id, nome: v.nome, colonne: v.colonne });
    }
  }
  const ctrl = righeIntegrazione(dbh, "network_controllers", COLONNE_CONTROLLER);
  piano.controller = ctrl.con;
  piano.controllerSenzaVoce = ctrl.senza;
  const ad = righeIntegrazione(dbh, "ad_integrations", COLONNE_AD);
  piano.ad = ad.con;
  piano.adSenzaVoce = ad.senza;
  for (const t of TABELLE_CATENE_VECCHIE) {
    if (haTabella(dbh, t)) piano.tabelle.push({ nome: t, righe: (dbh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n });
  }
  return piano;
}

/** Quello che la conferma ha visto: se cambia fra la prova e la scrittura, non si scrive. */
function impronta(p: PianoPulizia): string {
  return JSON.stringify([
    p.tenant,
    p.lasciatiAccettati,
    p.apparati.map((a) => [a.device_id, a.colonne]),
    p.bloccanti.map((b) => [b.device_id, b.motivo]),
    p.controller.map((r) => r.id),
    p.controllerSenzaVoce.map((r) => r.id),
    p.ad.map((r) => r.id),
    p.adSenzaVoce.map((r) => r.id),
    p.tabelle,
  ]);
}

// ── La scrittura ────────────────────────────────────────────────────────────

export interface EsitoPulizia {
  segno: string;
  apparati: number;
  controller: number;
  ad: number;
  tabelle: string[];
}

/** Valore del segno `credenziali_t2_pulizia`: conteggi, lasciati accettati (id con «+») e ripieghi confermati. */
export function segnoPulizia(p: PianoPulizia, ripieghiConfermati: number, quando: Date): string {
  const conteggi = [
    `apparati_svuotati=${p.apparati.length}`,
    `controller_svuotati=${p.controller.length}`,
    `ad_svuotate=${p.ad.length}`,
    `tabelle_tolte=${p.tabelle.length}`,
    `controller_senza_voce=${p.controllerSenzaVoce.length}`,
    `ad_senza_voce=${p.adSenzaVoce.length}`,
    `lasciati_accettati=${p.lasciatiAccettati.length > 0 ? p.lasciatiAccettati.join("+") : "nessuno"}`,
    `ripieghi_confermati=${ripieghiConfermati}`,
  ].join(",");
  return `done:${quando.toISOString()}:${conteggi}`;
}

/**
 * Scrive la pulizia, in una transazione: rifà il piano e, se non è quello
 * confermato o ha dei bloccanti, non scrive niente. Svuota, toglie le due
 * tabelle (due istruzioni), controlla e scrive il segno; un errore qualunque
 * annulla tutto. Il backup lo fa chi chiama, prima.
 */
export function applicaPuliziaDb(dbh: Database.Database, piano: PianoPulizia, opzioni: { ripieghiConfermati: number; quando?: Date }): EsitoPulizia {
  const quando = opzioni.quando ?? new Date();
  return dbh.transaction((): EsitoPulizia => {
    const gia = puliziaFatta(dbh);
    if (gia) throw new Error(`Pulizia già fatta su questo tenant (segno «${gia.slice(0, 80)}»): niente da fare`);
    const adesso = pianoPuliziaDb(dbh, piano.tenant, piano.lasciatiAccettati);
    if (impronta(adesso) !== impronta(piano)) {
      throw new Error("Il DB è cambiato fra la prova e la scrittura: niente scritto, rilancia la pulizia a vuoto e rileggi il piano");
    }
    if (adesso.bloccanti.length > 0) {
      throw new Error(`Apparati che bloccano la pulizia: ${adesso.bloccanti.map((b) => `#${b.device_id}`).join(", ")}: niente scritto`);
    }

    const presenti = colonneDi(dbh, "network_devices");
    for (const a of adesso.apparati) {
      const colonne = a.colonne.filter((c) => presenti.has(c));
      dbh.prepare(`UPDATE network_devices SET ${colonne.map((c) => `${c} = NULL`).join(", ")} WHERE id = ?`).run(a.device_id);
    }
    const svuotaCtrl = dbh.prepare("UPDATE network_controllers SET username = '', password_enc = '', api_key_enc = '' WHERE id = ? AND credential_id IS NOT NULL");
    for (const r of adesso.controller) svuotaCtrl.run(r.id);
    if (adesso.ad.length > 0) {
      const svuotaAd = dbh.prepare("UPDATE ad_integrations SET encrypted_username = '', encrypted_password = '' WHERE id = ? AND credential_id IS NOT NULL");
      for (const r of adesso.ad) svuotaAd.run(r.id);
    }
    // Due istruzioni: SQLite toglie una tabella per istruzione.
    dbh.exec("DROP TABLE IF EXISTS network_host_credentials");
    dbh.exec("DROP TABLE IF EXISTS host_detect_credential");

    // Controllo: niente rimasto di quello che si doveva togliere.
    const dopo = pianoPuliziaDb(dbh, piano.tenant, piano.lasciatiAccettati);
    const rimasti = [
      ...dopo.apparati.map((a) => `apparato #${a.device_id}`),
      ...dopo.bloccanti.map((b) => `apparato #${b.device_id}`),
      ...dopo.controller.map((r) => `controller #${r.id}`),
      ...dopo.ad.map((r) => `AD #${r.id}`),
      ...dopo.tabelle.map((t) => t.nome),
    ];
    if (rimasti.length > 0) throw new Error(`Dopo la pulizia resta ancora: ${rimasti.join(", ")}: annullato`);

    const segno = segnoPulizia(adesso, opzioni.ripieghiConfermati, quando);
    scriviSegno(dbh, SEGNO_PULIZIA, segno);
    return { segno, apparati: adesso.apparati.length, controller: adesso.controller.length, ad: adesso.ad.length, tabelle: adesso.tabelle.map((t) => t.nome) };
  })();
}
