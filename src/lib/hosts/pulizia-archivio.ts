/**
 * Archivio degli host tolti dalla pulizia (piano 2026-10-20, Task 1; scelta A di Riccardo).
 *
 * Archiviare = fotografare la riga di `hosts` in `hosts_archivio` (JSON, meno le colonne generate) e poi
 * cancellarla con un DELETE diretto: le figlie seguono le loro regole ON DELETE (CASCADE via, SET NULL
 * restano senza host). Mai `deleteHost`: quello scrive `excluded_ips`, e un oggetto archiviato che torna in
 * rete la scansione lo deve ritrovare (P2: nessun recupero automatico, l'elenco dice «di nuovo in rete»).
 *
 * Recuperare = reinserire l'istantanea come host nuovo (id nuovo, `status = 'offline'`: lo stato vero lo dice
 * la prossima scansione), con le sole colonne che `hosts` ha adesso. Si rifiuta, senza scrivere, se la rete
 * non c'è più o se l'IP è di nuovo occupato.
 *
 * Ogni operazione scrive una riga nel registro (`registro-pulizia.ts`) PRIMA del commit: se il registro non
 * si scrive, l'operazione si annulla.
 *
 * Lavora sul DB del tenant del contesto (`withTenant`); senza contesto lancia, mai ripieghi su DEFAULT.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb, runInTenantTransaction } from "@/lib/db-tenant";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { macToHex, normalizeMacForStorage } from "@/lib/utils";
import { scriviRegistroPulizia, scriviRighePulizia, type RigaRegistroPulizia } from "@/lib/hosts/registro-pulizia";

export const GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE = 90;

export type MotivoPulizia = "assente" | "cambio_ip";

export interface RigaArchivio {
  id: number;
  hostIdOriginale: number;
  networkId: number;
  ip: string;
  macHex: string | null;
  nome: string;
  motivo: MotivoPulizia;
  dettaglio: string | null;
  ultimaVista: string | null;
  archiviatoIl: string;
  archiviatoDa: string;
  recuperatoIl: string | null;
  nuovoHostId: number | null;
  /** Calcolato in lettura: IP di un host online con lo stesso MAC adesso (P2). */
  diNuovoInRete: string | null;
}

export type EsitoRecupero = { ok: true; nuovoHostId: number } | { ok: false; motivo: string };

interface RigaArchivioDb {
  id: number;
  host_id_originale: number;
  network_id: number;
  ip: string;
  mac_hex: string | null;
  nome: string;
  motivo: MotivoPulizia;
  dettaglio: string | null;
  ultima_vista: string | null;
  istantanea: string;
  archiviato_il: string;
  archiviato_da: string;
  recuperato_il: string | null;
  recuperato_da: string | null;
  nuovo_host_id: number | null;
}

type IpPrecedente = { ip: string; fino_al: string };

function dbCorrente(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant: la pulizia degli host lavora solo dentro withTenant()");
  return getTenantDb(code);
}

/**
 * Il MAC come chiave (12 cifre esadecimali, la forma di `mac_ip_history.mac_normalized`), o null.
 * `macToHex` da solo riempie di zeri: «AB:CD» diventerebbe ABCD00000000 e legherebbe l'host a un MAC che non c'è.
 */
function macHexValido(mac: unknown): string | null {
  if (typeof mac !== "string" || !normalizeMacForStorage(mac)) return null;
  return macToHex(mac);
}

function testo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** custom_name || hostname || dns_reverse || ip */
function nomeDi(h: Record<string, unknown>): string {
  return testo(h.custom_name) ?? testo(h.hostname) ?? testo(h.dns_reverse) ?? String(h.ip);
}

/** Le colonne di `hosts` per tipo: le generate (os_family) non si fotografano né si reinseriscono. */
function colonneHosts(d: Database.Database): { normali: string[]; generate: Set<string> } {
  const righe = d.prepare("PRAGMA table_xinfo(hosts)").all() as Array<{ name: string; hidden: number }>;
  return {
    normali: righe.filter((c) => c.hidden === 0).map((c) => c.name),
    generate: new Set(righe.filter((c) => c.hidden !== 0).map((c) => c.name)),
  };
}

/** IP diversi da `ipAttuale` che lo storico conosce per questo MAC, con l'ultima volta (più recente prima). */
function ipDalloStorico(d: Database.Database, macHex: string, ipAttuale: string): IpPrecedente[] {
  // changed_at ha un default: una riga senza data non c'è nei dati veri, e senza data non si saprebbe ordinarla.
  return d.prepare(`SELECT ip, MAX(changed_at) AS fino_al FROM mac_ip_history
      WHERE mac_normalized = ? AND ip <> ? GROUP BY ip HAVING MAX(changed_at) IS NOT NULL ORDER BY fino_al DESC`)
    .all(macHex, ipAttuale) as IpPrecedente[];
}

/** IP degli host online adesso, per MAC (una lettura sola per tutto l'elenco; a parità di MAC, il visto più di recente). */
function ipOnlinePerMac(d: Database.Database, macs: Set<string>): Map<string, string> {
  const esito = new Map<string, string>();
  if (macs.size === 0) return esito;
  const online = d.prepare("SELECT ip, mac FROM hosts WHERE status = 'online' AND mac IS NOT NULL AND mac <> '' ORDER BY last_seen DESC, id DESC")
    .all() as Array<{ ip: string; mac: string }>;
  for (const h of online) {
    const hex = macHexValido(h.mac);
    if (hex && macs.has(hex) && !esito.has(hex)) esito.set(hex, h.ip);
  }
  return esito;
}

function versoRiga(r: RigaArchivioDb, online: Map<string, string>): RigaArchivio {
  return {
    id: r.id,
    hostIdOriginale: r.host_id_originale,
    networkId: r.network_id,
    ip: r.ip,
    macHex: r.mac_hex,
    nome: r.nome,
    motivo: r.motivo,
    dettaglio: r.dettaglio,
    ultimaVista: r.ultima_vista,
    archiviatoIl: r.archiviato_il,
    archiviatoDa: r.archiviato_da,
    recuperatoIl: r.recuperato_il,
    nuovoHostId: r.nuovo_host_id,
    diNuovoInRete: r.mac_hex ? online.get(r.mac_hex) ?? null : null,
  };
}

function dataOra(valore: string): string {
  const t = parseDbDate(valore);
  if (Number.isNaN(t.getTime())) return valore;
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, dateStyle: "short", timeStyle: "short" }).format(t);
}

/**
 * Fotografa l'host in `hosts_archivio` e lo toglie da `hosts`, in una transazione con la riga di registro.
 * Lancia se l'host non c'è, se non è offline o se il registro non si scrive (e allora non cambia niente).
 * `diNuovoInRete` è sempre null qui: l'host appena archiviato era offline, e il ritorno del MAC lo dice l'elenco.
 */
export function archiviaHost(hostId: number, motivo: MotivoPulizia, dettaglio: string, da: string): RigaArchivio {
  const d = dbCorrente();
  const tenant = getCurrentTenantCode();
  return runInTenantTransaction(() => {
    const host = d.prepare("SELECT * FROM hosts WHERE id = ?").get(hostId) as Record<string, unknown> | undefined;
    if (!host) throw new Error(`host #${hostId} non trovato`);
    // Freno anche qui, non solo nella scelta dei candidati: un host online o «unknown» non si archivia mai.
    if (host.status !== "offline") throw new Error(`host #${hostId} non è offline (${String(host.status)}): non si archivia`);
    const { generate } = colonneHosts(d);
    const foto = Object.fromEntries(Object.entries(host).filter(([col]) => !generate.has(col)));
    const ip = String(host.ip);
    const macHex = macHexValido(host.mac);
    const ipPrecedenti = macHex ? ipDalloStorico(d, macHex, ip) : [];
    const nome = nomeDi(host);
    const ultimaVista = typeof host.last_seen === "string" ? host.last_seen : null;

    const archivioId = Number(d.prepare(`INSERT INTO hosts_archivio
        (host_id_originale, network_id, ip, mac_hex, nome, motivo, dettaglio, ultima_vista, istantanea, archiviato_da)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(hostId, host.network_id, ip, macHex, nome, motivo, dettaglio, ultimaVista,
        JSON.stringify({ host: foto, ip_precedenti: ipPrecedenti }), da).lastInsertRowid);
    // DELETE diretto, non deleteHost: niente excluded_ips (vedi in testa).
    const tolte = d.prepare("DELETE FROM hosts WHERE id = ?").run(hostId).changes;
    if (tolte !== 1) throw new Error(`host #${hostId}: cancellazione non riuscita (${tolte} righe)`);

    scriviRegistroPulizia({ azione: "archivia", tenant, archivioId, hostId, ip, mac: macHex, nome, motivo: `${motivo}: ${dettaglio}`, da });

    const r = d.prepare("SELECT * FROM hosts_archivio WHERE id = ?").get(archivioId) as RigaArchivioDb;
    return versoRiga(r, new Map());
  });
}

/** Come si chiamano a schermo e nel registro le tabelle a cui puntano le chiavi esterne di hosts. */
const NOMI_COLLEGAMENTI: Readonly<Record<string, string>> = { physical_devices: "apparato fisico" };

/** Valori che better-sqlite3 sa scrivere; l'istantanea viene da JSON, quindi altro non dovrebbe esserci. */
function scrivibile(v: unknown): v is string | number | null {
  return v === null || typeof v === "string" || typeof v === "number";
}

/**
 * Rimette in `hosts` l'host archiviato (id nuovo, offline). Rifiuta, senza scrivere niente, se la riga è già
 * recuperata, se la rete non c'è più, se l'IP è fra gli esclusi della rete, se `(network_id, ip)` è di nuovo
 * occupato o se un collegamento (chiave esterna non SET NULL) punta a una riga che non c'è più.
 */
export function recuperaHost(archivioId: number, da: string): EsitoRecupero {
  const d = dbCorrente();
  const tenant = getCurrentTenantCode();
  return runInTenantTransaction((): EsitoRecupero => {
    const a = d.prepare("SELECT * FROM hosts_archivio WHERE id = ?").get(archivioId) as RigaArchivioDb | undefined;
    if (!a) return { ok: false, motivo: `riga d'archivio #${archivioId} non trovata` };
    if (a.recuperato_il) return { ok: false, motivo: `già recuperato il ${dataOra(a.recuperato_il)}` };

    let host: Record<string, unknown>;
    try {
      const foto = JSON.parse(a.istantanea) as { host?: unknown };
      if (!foto || typeof foto.host !== "object" || foto.host === null) throw new Error("manca l'host");
      host = foto.host as Record<string, unknown>;
    } catch {
      return { ok: false, motivo: `istantanea della riga d'archivio #${archivioId} illeggibile` };
    }

    if (!d.prepare("SELECT 1 FROM networks WHERE id = ?").get(a.network_id)) return { ok: false, motivo: "la rete non esiste più" };
    // Escluso a mano dopo l'archiviazione (archiviare non scrive excluded_ips): quella scelta vince sul recupero.
    const esclusione = d.prepare("SELECT excluded_at FROM excluded_ips WHERE network_id = ? AND ip = ?")
      .get(a.network_id, a.ip) as { excluded_at: string | null } | undefined;
    if (esclusione) {
      const quando = esclusione.excluded_at ? ` (dal ${dataOra(esclusione.excluded_at)})` : "";
      return { ok: false, motivo: `l'IP ${a.ip} è fra gli IP esclusi della rete${quando}` };
    }
    const occupante = d.prepare("SELECT id, ip, custom_name, hostname, dns_reverse FROM hosts WHERE network_id = ? AND ip = ?")
      .get(a.network_id, a.ip) as (Record<string, unknown> & { id: number }) | undefined;
    if (occupante) return { ok: false, motivo: `l'IP ${a.ip} è di nuovo in uso da ${nomeDi(occupante)} (#${occupante.id})` };

    // Solo le colonne che hosts ha adesso (caso 4 del piano): una tolta si perde, una nuova prende il suo default.
    const valori = new Map<string, string | number | null>();
    for (const col of colonneHosts(d).normali) {
      if (col === "id" || !Object.hasOwn(host, col)) continue;
      const v = host[col];
      if (!scrivibile(v)) return { ok: false, motivo: `istantanea della riga d'archivio #${archivioId}: valore non valido in ${col}` };
      valori.set(col, v);
    }
    valori.set("network_id", a.network_id);
    valori.set("ip", a.ip);
    valori.set("status", "offline");
    // Un riferimento a una riga sparita nel frattempo: se la chiave è ON DELETE SET NULL (oggi physical_device_id) si
    // vuota, perché è ciò che sarebbe successo se l'host fosse rimasto, e si scrive nel registro; con ogni altra regola
    // ci si rifiuta. Senza, l'INSERT cadrebbe sulla chiave esterna. La rete è già controllata sopra.
    const chiavi = d.prepare("PRAGMA foreign_key_list(hosts)").all() as Array<{ table: string; from: string; to: string | null; on_delete: string }>;
    const vuotati: string[] = [];
    for (const k of chiavi) {
      const v = valori.get(k.from);
      if (k.from === "network_id" || v === undefined || v === null) continue;
      if (d.prepare(`SELECT 1 FROM "${k.table}" WHERE "${k.to ?? "rowid"}" = ?`).get(v)) continue;
      if (k.on_delete.toUpperCase() !== "SET NULL") {
        return { ok: false, motivo: `il collegamento ${k.from} punta a ${k.table} #${v}, che non esiste più` };
      }
      valori.set(k.from, null);
      vuotati.push(`senza ${NOMI_COLLEGAMENTI[k.table] ?? k.table} #${v}`);
    }

    const colonne = [...valori.keys()];
    const nuovoHostId = Number(d.prepare(`INSERT INTO hosts (${colonne.map((c) => `"${c}"`).join(", ")}) VALUES (${colonne.map(() => "?").join(", ")})`)
      .run(...colonne.map((c) => valori.get(c) ?? null)).lastInsertRowid);
    d.prepare("UPDATE hosts_archivio SET recuperato_il = datetime('now'), recuperato_da = ?, nuovo_host_id = ? WHERE id = ?")
      .run(da, nuovoHostId, archivioId);

    const motivo = [a.motivo, ...vuotati].join("; ");
    scriviRegistroPulizia({ azione: "recupera", tenant, archivioId, hostId: nuovoHostId, ip: a.ip, mac: a.mac_hex, nome: a.nome, motivo, da });
    return { ok: true, nuovoHostId };
  });
}

/**
 * Cancella per sempre le righe archiviate da più di 90 giorni (recuperate comprese). Una riga di registro per riga,
 * scritte tutte insieme con una scrittura sola dopo i DELETE e prima del COMMIT: o tutte o nessuna.
 */
export function cancellaArchivioScaduto(): Array<{ id: number; ip: string; nome: string }> {
  const d = dbCorrente();
  const tenant = getCurrentTenantCode();
  return runInTenantTransaction(() => {
    const scadute = d.prepare("SELECT id, ip, nome, mac_hex FROM hosts_archivio WHERE archiviato_il < datetime('now', ?) ORDER BY id")
      .all(`-${GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE} days`) as Array<{ id: number; ip: string; nome: string; mac_hex: string | null }>;
    const togli = d.prepare("DELETE FROM hosts_archivio WHERE id = ?");
    const registro: RigaRegistroPulizia[] = [];
    for (const r of scadute) {
      togli.run(r.id);
      registro.push({
        azione: "cancella", tenant, archivioId: r.id, hostId: null, ip: r.ip, mac: r.mac_hex, nome: r.nome,
        motivo: `in archivio da più di ${GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE} giorni`, da: "sistema",
      });
    }
    scriviRighePulizia(registro);
    return scadute.map(({ id, ip, nome }) => ({ id, ip, nome }));
  });
}

/** Righe archiviate e non recuperate, più recenti prima, al massimo `limite`; `totale` le conta tutte. */
export function listaArchivio(limite = 500): { righe: RigaArchivio[]; totale: number } {
  const d = dbCorrente();
  const n = Number.isFinite(limite) ? Math.max(0, Math.floor(limite)) : 500;
  const righe = d.prepare("SELECT * FROM hosts_archivio WHERE recuperato_il IS NULL ORDER BY archiviato_il DESC, id DESC LIMIT ?")
    .all(n) as RigaArchivioDb[];
  const online = ipOnlinePerMac(d, new Set(righe.map((r) => r.mac_hex).filter((m): m is string => m !== null)));
  return { righe: righe.map((r) => versoRiga(r, online)), totale: contaArchiviati() };
}

/** Quante righe archiviate e non recuperate. */
export function contaArchiviati(): number {
  return (dbCorrente().prepare("SELECT COUNT(*) AS n FROM hosts_archivio WHERE recuperato_il IS NULL").get() as { n: number }).n;
}

/**
 * Gli IP che il MAC dell'host ha avuto prima di quello attuale: dallo storico (`mac_ip_history`) e dall'archivio
 * (righe non recuperate dello stesso MAC). Un IP una volta sola, con la data più recente; più recente prima.
 * Host che non c'è o MAC non valido: elenco vuoto.
 */
export function ipPrecedentiDi(hostId: number): Array<{ ip: string; fino_al: string; fonte: "storico" | "archivio" }> {
  const d = dbCorrente();
  const host = d.prepare("SELECT ip, mac FROM hosts WHERE id = ?").get(hostId) as { ip: string; mac: string | null } | undefined;
  const macHex = host ? macHexValido(host.mac) : null;
  if (!host || !macHex) return [];
  const archivio = d.prepare(`SELECT ip, COALESCE(ultima_vista, archiviato_il) AS fino_al FROM hosts_archivio
      WHERE mac_hex = ? AND recuperato_il IS NULL AND ip <> ?`).all(macHex, host.ip) as IpPrecedente[];
  const quando = (s: string): number => {
    const t = parseDbDate(s).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  const perIp = new Map<string, { ip: string; fino_al: string; fonte: "storico" | "archivio" }>();
  const candidati = [
    ...ipDalloStorico(d, macHex, host.ip).map((p) => ({ ...p, fonte: "storico" as const })),
    ...archivio.map((p) => ({ ...p, fonte: "archivio" as const })),
  ];
  for (const p of candidati) {
    const gia = perIp.get(p.ip);
    if (!gia || quando(p.fino_al) > quando(gia.fino_al)) perIp.set(p.ip, p);
  }
  return [...perIp.values()].sort((x, y) => quando(y.fino_al) - quando(x.fino_al));
}
