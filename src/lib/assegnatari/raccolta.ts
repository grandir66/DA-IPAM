/**
 * Raccolta di chi si collega ai PC (piano 2026-10-23-assegnatari-da-ad, passo 3), in `host_accessi_utente`.
 *
 * - **Wazuh, alla tastiera**: eventi 4624 di tipo 2 (console), 10 (desktop remoto), 11 (sblocco con credenziali in cache)
 *   raccolti dall'agente sul PC → host per `agent.name` (`wazuh_agent.host_id`).
 * - **Wazuh, di rete**: eventi 4624 di tipo 3 visti da server e controller di dominio, per `workstationName` → host per
 *   nome (computer di AD, nomi degli host) o, se il nome non si trova, per `ipAddress`. È la fonte più larga (misura del
 *   23/10 sull'hub .8: 38 postazioni contro 11 PC con l'agente) e copre i PC senza agente né WinRM.
 * - **WinRM**: l'utente collegato letto con l'inventario dell'apparato (`last_device_info_json`), una presenza al giorno.
 * - **GLPI**: l'ultimo utente dell'inventario dell'agente, all'arrivo (rotta di ingresso).
 *
 * Wazuh si legge per aggregazione (size 0, nessun documento), una finestra per giorno UTC, dal cursore in avanti: la
 * prima volta si parte da `giorni` indietro. Righe e cursore si scrivono nella stessa transazione, così un giro rotto a
 * metà riparte dall'ultima finestra completa senza contare due volte.
 */
import type Database from "better-sqlite3";
import { eAccountDiSistema, normalizzaAccount } from "./account";
import { CHIAVE_CURSORE_WAZUH, registraAccessi, scriviImpostazione, type RigaAccesso } from "./db";

export type TipoAccesso = "tastiera" | "rete";
export const TIPI_LOGON: Record<TipoAccesso, string[]> = { tastiera: ["2", "10", "11"], rete: ["3"] };
const CAMPO_HOST: Record<TipoAccesso, string> = { tastiera: "agent.name", rete: "data.win.eventdata.workstationName" };
const UTENTE = "data.win.eventdata.targetUserName";
/** Gli account di sistema che si escludono già nell'indexer (il resto lo filtra `eAccountDiSistema`). */
const ESCLUSI_NELL_INDEXER = ["SYSTEM", "ANONYMOUS LOGON", "LOCAL SERVICE", "NETWORK SERVICE", "-"];
/** Ritardo d'indicizzazione: la finestra si chiude un po' prima di adesso. */
export const RITARDO_MS = 2 * 60_000;

/** Il corpo dell'aggregazione per una finestra [da, a). */
export function queryAccessi(tipo: TipoAccesso, da: Date, a: Date): Record<string, unknown> {
  const perHost: Record<string, unknown> = {
    terms: { field: CAMPO_HOST[tipo], size: 5000 },
    aggs: {
      utenti: {
        terms: { field: UTENTE, size: 200 },
        aggs: { ultimo: { max: { field: "@timestamp" } } },
      },
      ...(tipo === "rete" ? { ip: { terms: { field: "data.win.eventdata.ipAddress", size: 1 } } } : {}),
    },
  };
  return {
    size: 0,
    track_total_hits: false,
    query: {
      bool: {
        filter: [
          { range: { "@timestamp": { gte: da.toISOString(), lt: a.toISOString() } } },
          { term: { "data.win.system.eventID": "4624" } },
          { terms: { "data.win.eventdata.logonType": TIPI_LOGON[tipo] } },
        ],
        must_not: [
          { terms: { [UTENTE]: ESCLUSI_NELL_INDEXER } },
          { wildcard: { [UTENTE]: { value: "*$" } } },
        ],
      },
    },
    aggs: { per_host: perHost },
  };
}

export interface BucketAccessi {
  chiave: string;
  ip: string | null;
  utenti: Array<{ account: string; conteggio: number; ultimo: string | null }>;
}

type Bucket = { key?: unknown; doc_count?: unknown; key_as_string?: unknown } & Record<string, unknown>;
const bucketsDi = (x: unknown): Bucket[] => {
  const b = (x as { buckets?: unknown } | undefined)?.buckets;
  return Array.isArray(b) ? (b as Bucket[]) : [];
};

/** Il massimo di `@timestamp` (millisecondi in `value`, o `value_as_string`) nel formato del DB: UTC «YYYY-MM-DD HH:MM:SS». */
function oraDb(agg: unknown): string | null {
  const a = agg as { value?: unknown; value_as_string?: unknown } | undefined;
  const ms = typeof a?.value === "number" ? a.value : typeof a?.value_as_string === "string" ? Date.parse(a.value_as_string) : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Dalla risposta dell'indexer ai bucket host → utenti. Una risposta senza aggregazioni dà un elenco vuoto. */
export function leggiRispostaAccessi(raw: unknown): BucketAccessi[] {
  const aggs = (raw as { aggregations?: Record<string, unknown> } | null)?.aggregations;
  const out: BucketAccessi[] = [];
  for (const h of bucketsDi(aggs?.per_host)) {
    if (typeof h.key !== "string" || !h.key.trim()) continue;
    const ip = bucketsDi(h.ip)[0]?.key;
    out.push({
      chiave: h.key,
      ip: typeof ip === "string" && ip !== "-" ? ip : null,
      utenti: bucketsDi(h.utenti).flatMap((u) => {
        if (typeof u.key !== "string") return [];
        return [{ account: u.key, conteggio: Number(u.doc_count ?? 0), ultimo: oraDb(u.ultimo) }];
      }),
    });
  }
  return out;
}

/** Le finestre [da, a) spezzate alla mezzanotte UTC: ognuna sta in un giorno solo. */
export function finestre(da: Date, a: Date): Array<{ da: Date; a: Date; giorno: string }> {
  const out: Array<{ da: Date; a: Date; giorno: string }> = [];
  let inizio = da.getTime();
  const fine = a.getTime();
  while (inizio < fine) {
    const d = new Date(inizio);
    const mezzanotte = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const stop = Math.min(mezzanotte, fine);
    out.push({ da: new Date(inizio), a: new Date(stop), giorno: d.toISOString().slice(0, 10) });
    inizio = stop;
  }
  return out;
}

const primaEtichetta = (n: string | null | undefined): string | null => {
  const t = (n ?? "").trim().toLowerCase();
  if (!t) return null;
  return t.split(".")[0] || null;
};

/** Da nome di agente, nome di postazione o IP all'host del cliente. Si costruisce una volta per giro. */
export interface RisolviHost {
  perAgente(nome: string): number | null;
  perPostazione(nome: string, ip: string | null): number | null;
}

export function mappaHost(db: Database.Database): RisolviHost {
  const agenti = new Map<string, number>();
  for (const r of db.prepare("SELECT name, hostname, host_id FROM wazuh_agent WHERE host_id IS NOT NULL").all() as Array<{ name: string | null; hostname: string | null; host_id: number }>) {
    for (const n of [r.name, r.hostname]) {
      const k = primaEtichetta(n);
      if (k && !agenti.has(k)) agenti.set(k, r.host_id);
    }
  }
  const nomi = new Map<string, number>();
  // Prima i computer di AD (il nome NetBIOS è proprio quello di workstationName), poi i nomi degli host.
  for (const r of db.prepare("SELECT sam_account_name, dns_host_name, host_id FROM ad_computers WHERE host_id IS NOT NULL").all() as Array<{ sam_account_name: string; dns_host_name: string | null; host_id: number }>) {
    for (const n of [r.sam_account_name.replace(/\$$/, ""), r.dns_host_name]) {
      const k = primaEtichetta(n);
      if (k && !nomi.has(k)) nomi.set(k, r.host_id);
    }
  }
  const ip = new Map<string, number | null>();
  for (const r of db.prepare("SELECT id, ip, hostname, custom_name, dns_forward, dns_reverse FROM hosts").all() as Array<{ id: number; ip: string; hostname: string | null; custom_name: string | null; dns_forward: string | null; dns_reverse: string | null }>) {
    for (const n of [r.hostname, r.dns_reverse, r.dns_forward, r.custom_name]) {
      const k = primaEtichetta(n);
      if (k && !nomi.has(k)) nomi.set(k, r.id);
    }
    // Lo stesso IP in due reti: ambiguo, non si usa.
    ip.set(r.ip, ip.has(r.ip) ? null : r.id);
  }
  return {
    perAgente: (nome) => agenti.get(primaEtichetta(nome) ?? "") ?? null,
    perPostazione: (nome, indirizzo) => {
      const k = primaEtichetta(nome);
      if (k && nomi.has(k)) return nomi.get(k)!;
      return indirizzo ? ip.get(indirizzo) ?? null : null;
    },
  };
}

/** Dai bucket alle righe da scrivere: account normalizzati, di sistema fuori, host risolto o la riga si scarta. */
export function righeDaBuckets(buckets: readonly BucketAccessi[], tipo: TipoAccesso, giorno: string, risolvi: RisolviHost): { righe: RigaAccesso[]; senzaHost: number } {
  const righe = new Map<string, RigaAccesso>();
  let senzaHost = 0;
  for (const b of buckets) {
    const hostId = tipo === "tastiera" ? risolvi.perAgente(b.chiave) : risolvi.perPostazione(b.chiave, b.ip);
    if (hostId === null) {
      senzaHost++;
      continue;
    }
    for (const u of b.utenti) {
      const account = normalizzaAccount(u.account);
      if (!account || eAccountDiSistema(account) || u.conteggio <= 0) continue;
      const fonte = tipo === "tastiera" ? "wazuh_tastiera" : "wazuh_rete";
      const k = `${hostId}|${account}`;
      const r = righe.get(k);
      // «DOMINIO\utente» e «utente» nello stesso host diventano una riga sola.
      if (r) {
        r.conteggio += u.conteggio;
        if (u.ultimo && (!r.ultimo || u.ultimo > r.ultimo)) r.ultimo = u.ultimo;
      } else {
        righe.set(k, { hostId, account, fonte, giorno, conteggio: u.conteggio, ultimo: u.ultimo });
      }
    }
  }
  return { righe: [...righe.values()], senzaHost };
}

/** L'utente collegato visto da WinRM negli apparati Windows, una presenza al giorno dell'ultima lettura. */
export function righeWinrm(db: Database.Database, giorni: number): RigaAccesso[] {
  // `network_devices.host_id` lo aggiunge un ALTER all'apertura del tenant (db-tenant.ts), non lo schema di base.
  const conHostId = (db.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).some((c) => c.name === "host_id");
  const perIp = "(SELECT h.id FROM hosts h WHERE h.ip = nd.host ORDER BY h.id LIMIT 1)";
  const righe = db.prepare(
    `SELECT ${conHostId ? `COALESCE(nd.host_id, ${perIp})` : perIp} AS host_id,
            nd.last_info_update AS letto, nd.last_device_info_json AS json
     FROM network_devices nd
     WHERE nd.last_device_info_json LIKE '%logged_on%' AND nd.last_info_update IS NOT NULL
       AND substr(replace(nd.last_info_update, 'T', ' '), 1, 10) >= date('now', ?)`,
  ).all(`-${giorni} days`) as Array<{ host_id: number | null; letto: string; json: string }>;
  const out: RigaAccesso[] = [];
  for (const r of righe) {
    if (r.host_id === null) continue;
    let info: { last_logged_on_user?: unknown; logged_on_users?: unknown };
    try {
      info = JSON.parse(r.json) as typeof info;
    } catch {
      continue;
    }
    const nomi = new Set<string>();
    const ultimo = normalizzaAccount(typeof info.last_logged_on_user === "string" ? info.last_logged_on_user : null);
    if (ultimo) nomi.add(ultimo);
    if (Array.isArray(info.logged_on_users)) {
      for (const u of info.logged_on_users) {
        const n = normalizzaAccount(typeof (u as { username?: unknown })?.username === "string" ? (u as { username: string }).username : null);
        if (n) nomi.add(n);
      }
    }
    const letto = r.letto.replace("T", " ").replace(/Z$/, "").slice(0, 19);
    for (const account of nomi) {
      if (eAccountDiSistema(account)) continue;
      out.push({ hostId: r.host_id, account, fonte: "winrm", giorno: letto.slice(0, 10), conteggio: 1, ultimo: letto });
    }
  }
  return out;
}

export interface EsitoRaccolta {
  finestre: number;
  righe: number;
  /** Bucket di Wazuh il cui PC non si è trovato fra gli host del cliente. */
  senzaHost: number;
  winrm: number;
  /** Fino a dove si è letto Wazuh (ISO), o null se Wazuh non c'è. */
  cursore: string | null;
}

/** Quel che serve dell'indexer (sostituibile nelle prove con una risposta della forma vera). */
export interface IndexerAccessi {
  aggregaAlert(body: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Un giro: Wazuh dal cursore (o da `giorni` indietro) fino a adesso meno il ritardo, poi WinRM. `indexer` null = Wazuh
 * non configurato: si raccoglie solo WinRM. Un errore dell'indexer si rilancia dopo aver salvato le finestre già lette.
 */
export async function raccogliAccessi(db: Database.Database, indexer: IndexerAccessi | null, opz: { giorni: number; ora?: Date }): Promise<EsitoRaccolta> {
  const ora = opz.ora ?? new Date();
  const esito: EsitoRaccolta = { finestre: 0, righe: 0, senzaHost: 0, winrm: 0, cursore: null };
  if (indexer) {
    const fine = new Date(ora.getTime() - RITARDO_MS);
    const salvato = (db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CURSORE_WAZUH) as { value: string } | undefined)?.value;
    const piuVecchio = new Date(fine.getTime() - opz.giorni * 86_400_000);
    let da = salvato && !Number.isNaN(Date.parse(salvato)) ? new Date(salvato) : piuVecchio;
    if (da < piuVecchio) da = piuVecchio;
    const risolvi = mappaHost(db);
    for (const f of finestre(da, fine)) {
      const lette: RigaAccesso[] = [];
      for (const tipo of ["tastiera", "rete"] as const) {
        const raw = await indexer.aggregaAlert(queryAccessi(tipo, f.da, f.a));
        const { righe, senzaHost } = righeDaBuckets(leggiRispostaAccessi(raw), tipo, f.giorno, risolvi);
        lette.push(...righe);
        esito.senzaHost += senzaHost;
      }
      db.transaction(() => {
        registraAccessi(db, lette, "somma");
        scriviImpostazione(db, CHIAVE_CURSORE_WAZUH, f.a.toISOString());
      })();
      esito.finestre++;
      esito.righe += lette.length;
      esito.cursore = f.a.toISOString();
    }
    if (!esito.cursore) esito.cursore = da.toISOString();
  }
  const winrm = righeWinrm(db, opz.giorni);
  registraAccessi(db, winrm, "presenza");
  esito.winrm = winrm.length;
  return esito;
}
