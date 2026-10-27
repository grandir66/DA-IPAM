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
import { getCurrentTenantCode, runInTenantTransaction } from "@/lib/db-tenant";
import { dbCorrente } from "@/lib/hosts/db-corrente";
import { canonicalizza, unisciRuoli } from "@/lib/classification/canonico";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { macToHex, normalizeMacForStorage } from "@/lib/utils";
import { scriviRegistroPulizia, scriviRighePulizia, type RigaRegistroPulizia } from "@/lib/hosts/registro-pulizia";
import { candidatiPulizia } from "@/lib/hosts/pulizia-candidati";
import type { Candidato } from "@/lib/hosts/pulizia";
import { giroSullaRete } from "@/lib/scanner/network-scan-lock";
import { CHIAVI_SOGLIE_PULIZIA, sogliaPulizia } from "@/lib/hosts/soglie-pulizia";

export const GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE = 90;

/** I giorni d'archivio prima della cancellazione, per il cliente del contesto (Opzioni; di serie i 90 qui sopra). */
export function giorniArchivioPrimaDiCancellare(): number {
  return sogliaPulizia(CHIAVI_SOGLIE_PULIZIA.archivio, GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE);
}

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
    // L'istantanea può portare uno slug vecchio (server_windows, dns_server...): rientra già canonico, col ruolo.
    const cl = valori.get("classification");
    if (typeof cl === "string" && cl !== "") {
      const c = canonicalizza(cl);
      valori.set("classification", c.classificazione);
      if (c.ruolo && valori.has("server_roles")) {
        const r = valori.get("server_roles");
        valori.set("server_roles", unisciRuoli(typeof r === "string" ? r : null, c.ruolo));
      }
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
 * Le righe archiviate da più della soglia d'archivio del cliente (di serie 90 giorni) che si cancellano. Una riga recuperata no finché il suo host recuperato
 * esiste: è il segno «recuperato a mano» che lo tiene fuori dalla pulizia (`pulizia-candidati.ts`, I1 della
 * revisione finale, 20/10); se quell'host non c'è più, si cancella coi 90 giorni come le altre.
 */
function righeScadute(d: Database.Database): Array<{ id: number; ip: string; nome: string; mac_hex: string | null }> {
  return d.prepare(`SELECT a.id, a.ip, a.nome, a.mac_hex FROM hosts_archivio a
      WHERE a.archiviato_il < datetime('now', ?)
        AND (a.recuperato_il IS NULL OR NOT EXISTS (SELECT 1 FROM hosts h WHERE h.id = a.nuovo_host_id))
      ORDER BY a.id`)
    .all(`-${giorniArchivioPrimaDiCancellare()} days`) as Array<{ id: number; ip: string; nome: string; mac_hex: string | null }>;
}

/** Che cosa cancellerebbe adesso `cancellaArchivioScaduto`, senza scrivere: per la finestra di conferma di «Applica». */
export function archivioScaduto(): Array<{ id: number; ip: string; nome: string }> {
  return righeScadute(dbCorrente()).map(({ id, ip, nome }) => ({ id, ip, nome }));
}

/**
 * Cancella per sempre le righe d'archivio scadute (`righeScadute`). Una riga di registro per riga, scritte tutte
 * insieme con una scrittura sola dopo i DELETE e prima del COMMIT: o tutte o nessuna.
 */
export function cancellaArchivioScaduto(): Array<{ id: number; ip: string; nome: string }> {
  const d = dbCorrente();
  const tenant = getCurrentTenantCode();
  return runInTenantTransaction(() => {
    const scadute = righeScadute(d);
    const giorniArchivio = giorniArchivioPrimaDiCancellare();
    const togli = d.prepare("DELETE FROM hosts_archivio WHERE id = ?");
    const registro: RigaRegistroPulizia[] = [];
    for (const r of scadute) {
      togli.run(r.id);
      registro.push({
        azione: "cancella", tenant, archivioId: r.id, hostId: null, ip: r.ip, mac: r.mac_hex, nome: r.nome,
        motivo: `in archivio da più di ${giorniArchivio} giorni`, da: "sistema",
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
 * Per l'indicatore della dashboard (m11 della revisione finale): il numero, o «—» se non si legge. Un archivio
 * illeggibile non deve far cadere tutta la dashboard; nel journal solo il nome dell'errore (il testo può avere IP).
 */
export function contaArchiviatiOTrattino(): number | "—" {
  try {
    return contaArchiviati();
  } catch (error) {
    console.error("[dashboard] conteggio degli archiviati:", error instanceof Error ? error.name : "errore");
    return "—";
  }
}

/**
 * Gli IP che il MAC dell'host ha avuto prima di quello attuale: dallo storico (`mac_ip_history`) e dall'archivio
 * (righe non recuperate dello stesso MAC). Un IP una volta sola, con la data più recente; più recente prima.
 * Non sono «precedenti» gli IP che oggi stanno su un host (qualunque stato) con lo stesso MAC: un router o un
 * firewall con un'interfaccia per VLAN ha più IP adesso, non IP di prima (m10 della revisione finale).
 * Host che non c'è o MAC non valido: elenco vuoto.
 */
export function ipPrecedentiDi(hostId: number): Array<{ ip: string; fino_al: string; fonte: "storico" | "archivio" }> {
  const d = dbCorrente();
  const host = d.prepare("SELECT ip, mac FROM hosts WHERE id = ?").get(hostId) as { ip: string; mac: string | null } | undefined;
  const macHex = host ? macHexValido(host.mac) : null;
  if (!host || !macHex) return [];
  const archivio = d.prepare(`SELECT ip, COALESCE(ultima_vista, archiviato_il) AS fino_al FROM hosts_archivio
      WHERE mac_hex = ? AND recuperato_il IS NULL AND ip <> ?`).all(macHex, host.ip) as IpPrecedente[];
  // Gli IP di oggi dello stesso MAC, in qualunque forma sia scritto (AA:BB:…, aa-bb-…, aabb.cc…): il filtro SQL
  // sfronda, macHexValido decide.
  const ipDiOggi = new Set((d.prepare(`SELECT ip, mac FROM hosts WHERE mac IS NOT NULL
      AND UPPER(REPLACE(REPLACE(REPLACE(REPLACE(mac, ':', ''), '-', ''), '.', ''), ' ', '')) = ?`)
    .all(macHex) as Array<{ ip: string; mac: string }>).filter((h) => macHexValido(h.mac) === macHex).map((h) => h.ip));
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
    if (ipDiOggi.has(p.ip)) continue;
    const gia = perIp.get(p.ip);
    if (!gia || quando(p.fino_al) > quando(gia.fino_al)) perIp.set(p.ip, p);
  }
  return [...perIp.values()].sort((x, y) => quando(y.fino_al) - quando(x.fino_al));
}

// ═══════════════════════════════════════════════════════════════════════════
// «Applica» (piano 2026-10-20, Task 4; casi 3 e 5)
// ═══════════════════════════════════════════════════════════════════════════

type HostNominato = { id: number; ip: string; nome: string };
/** Un host mandato e non archiviato, col perché quando non si legge già dal nome (es. «rete in scansione, riprova dopo»). */
type HostNonArchiviato = HostNominato & { perche?: string };

/** Il perché degli host che «Applica» rimanda perché la loro rete è in scansione (m4 della revisione finale). */
export const PERCHE_RETE_IN_SCANSIONE = "rete in scansione, riprova dopo";

export interface EsitoApplica {
  /** Id dell'host (quello mandato), non della riga d'archivio. */
  archiviati: HostNominato[];
  /** Mandati ma non candidati adesso: tornati online, esclusi, troppo recenti, già archiviati, spariti, rete in scansione. */
  nonPiuCandidati: HostNonArchiviato[];
  /** Righe d'archivio (id della riga) oltre i 90 giorni, cancellate da questo «Applica». */
  cancellatiDallArchivio: HostNominato[];
}

/** La richiesta non è quella che l'utente ha confermato (numero diverso, elenco vuoto o storto): non si tocca niente. */
export class ErroreConferma extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroreConferma";
  }
}

/**
 * Un'archiviazione è fallita a metà dell'elenco. Ogni host si archivia nella sua transazione: quelli prima del
 * guasto restano archiviati (e nel registro), quello che ha fallito e i seguenti restano in `hosts`. Il messaggio
 * li nomina tutti; l'archivio scaduto in questo caso non si cancella.
 *
 * Il messaggio va al client: dice dove si è fermato (nome e IP dell'host, o la cancellazione dell'archivio
 * scaduto) con un testo fisso, mai il testo grezzo di SQLite (m2 della revisione finale). L'errore vero resta in
 * `cause`, e chi scrive il journal ne usa solo il nome con `hostIdFallito`.
 */
export class ErroreApplica extends Error {
  readonly hostIdFallito: number | null;
  constructor(
    readonly archiviati: HostNominato[],
    readonly nonArchiviati: HostNominato[],
    readonly nonPiuCandidati: HostNonArchiviato[],
    fallito: HostNominato | null,
    causa: unknown,
  ) {
    const elenco = (h: HostNominato[]) => (h.length ? h.map((x) => `${x.nome} (${x.ip})`).join(", ") : "nessuno");
    const dove = fallito
      ? `errore del database su ${fallito.nome} (${fallito.ip})`
      : "host archiviati, ma la cancellazione dell'archivio scaduto non è riuscita";
    super(`Archiviazione interrotta: ${dove}; il dettaglio è nel journal del server. `
      + `Archiviati: ${elenco(archiviati)}. Non archiviati, ancora fra gli host: ${elenco(nonArchiviati)}.`, { cause: causa });
    this.name = "ErroreApplica";
    this.hostIdFallito = fallito?.id ?? null;
  }
}

/** Nome e IP degli id mandati che non sono candidati: da `hosts`, se no dall'archivio, se no «non c'è più». Due letture, non una per id. */
function nominaNonCandidati(d: Database.Database, ids: number[]): HostNominato[] {
  if (ids.length === 0) return [];
  const elenco = JSON.stringify(ids);
  const vivi = new Map((d.prepare(`SELECT id, ip,
        COALESCE(NULLIF(TRIM(custom_name), ''), NULLIF(TRIM(hostname), ''), NULLIF(TRIM(dns_reverse), ''), ip) AS nome
      FROM hosts WHERE id IN (SELECT value FROM json_each(?))`).all(elenco) as HostNominato[]).map((h) => [h.id, h]));
  const archiviati = new Map((d.prepare(`SELECT host_id_originale AS id, ip, nome FROM hosts_archivio
      WHERE recuperato_il IS NULL AND host_id_originale IN (SELECT value FROM json_each(?)) ORDER BY id`).all(elenco) as HostNominato[])
    .map((h) => [h.id, h]));
  return ids.map((id) => {
    const vivo = vivi.get(id);
    if (vivo) return vivo;
    const a = archiviati.get(id);
    if (a) return { id, ip: a.ip, nome: `${a.nome} (già in archivio)` };
    return { id, ip: "", nome: `host #${id} (non c'è più)` };
  });
}

/**
 * «Applica» dell'anteprima: `ids` sono gli host che l'utente ha visto, `conferma` il numero che ha scritto.
 * - `conferma !== ids.length`, elenco vuoto, id ripetuti o non interi positivi → `ErroreConferma`, nessuna scrittura;
 * - si ricalcolano i candidati ADESSO e si archivia solo l'intersezione (motivo e dettaglio di adesso); gli altri id
 *   tornano per nome in `nonPiuCandidati` (caso 3: tornati online nel frattempo, o un id escluso in una richiesta
 *   scritta a mano);
 * - un candidato di una rete che un giro di scansione tiene adesso si rimanda, come fa il job (`inScansione`): torna
 *   fra i «non più candidati» col perché «rete in scansione, riprova dopo» (m4 della revisione finale);
 * - poi si cancella l'archivio scaduto (caso 5: a job spento nessun altro lo farebbe).
 * Un host per transazione (scelta del Task 4): un guasto a metà lascia archiviati i precedenti e lancia
 * `ErroreApplica`, che li nomina con quelli rimasti; un host che a metà non è più archiviabile va fra i «non più
 * candidati» (`archiviaElenco`, lo stesso giro del job notturno). Tutto sincrono: fra la lettura dei candidati e
 * l'ultima archiviazione nessun `await`, quindi la scansione dello stesso processo non si infila in mezzo.
 */
export function applicaPulizia(ids: number[], conferma: number, da: string): EsitoApplica {
  if (ids.length === 0) throw new ErroreConferma("Nessun host da archiviare nell'elenco");
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) throw new ErroreConferma("L'elenco contiene id di host non validi");
  if (new Set(ids).size !== ids.length) throw new ErroreConferma("L'elenco contiene lo stesso host più di una volta");
  if (conferma !== ids.length) {
    throw new ErroreConferma(`Il numero confermato (${conferma}) non è quello degli host nell'elenco (${ids.length}): non si archivia niente`);
  }

  const d = dbCorrente();
  const candidati = new Map(candidatiPulizia().candidati.map((c) => [c.id, c]));
  const scelti = ids.filter((id) => candidati.has(id)).map((id) => candidati.get(id)!);
  const nonPiuCandidati = nominaNonCandidati(d, ids.filter((id) => !candidati.has(id)));
  const occupato = inScansione(d, scelti);
  const daArchiviare = scelti.filter((c) => !occupato(c));
  const rinviati: HostNonArchiviato[] = scelti.filter(occupato).map((c) => ({ ...nominato(c), perche: PERCHE_RETE_IN_SCANSIONE }));

  const g = archiviaElenco(d, daArchiviare, da);
  // Saltati a metà giro (non più offline, spariti): per chi ha premuto «Applica» sono «non più candidati».
  const nonPiu = [...nonPiuCandidati, ...rinviati, ...g.saltati];
  if (!g.ok) throw new ErroreApplica(g.archiviati, g.nonArchiviati, nonPiu, g.fallito, g.errore);
  return { archiviati: g.archiviati, nonPiuCandidati: nonPiu, cancellatiDallArchivio: g.cancellatiDallArchivio };
}

/**
 * Chi fra i candidati sta su una rete che un giro di scansione tiene adesso (lucchetto in memoria,
 * `network-scan-lock`): il giro sta per riscrivere quegli host, e uno tolto sotto i suoi piedi diventerebbe un host
 * nuovo o un errore della scansione. Lo usano il job notturno e «Applica». Una lettura sola per le reti.
 */
function inScansione(d: Database.Database, candidati: Candidato[]): (c: Candidato) => boolean {
  const tenant = getCurrentTenantCode();
  const retePerHost = new Map((d.prepare("SELECT id, network_id FROM hosts WHERE id IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(candidati.map((c) => c.id))) as Array<{ id: number; network_id: number }>).map((r) => [r.id, r.network_id]));
  return (c) => {
    const rete = retePerHost.get(c.id);
    return tenant !== null && rete !== undefined && giroSullaRete(tenant, rete) !== undefined;
  };
}

const messaggio = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const nominato = ({ id, ip, nome }: HostNominato): HostNominato => ({ id, ip, nome });

/** Esito di `archiviaElenco`. */
type EsitoElenco =
  | { ok: true; archiviati: HostNominato[]; saltati: HostNominato[]; cancellatiDallArchivio: HostNominato[] }
  | {
    ok: false; archiviati: HostNominato[]; saltati: HostNominato[]; nonArchiviati: HostNominato[];
    /** L'host su cui si è fermato; null se è fallita la cancellazione dell'archivio scaduto. */
    fallito: HostNominato | null;
    errore: unknown;
  };

/**
 * Il giro comune a «Applica» e al job notturno: archivia i candidati già scelti, uno per transazione, poi cancella
 * l'archivio scaduto. Chi chiama decide come dire un guasto (ErroreApplica per nome a chi ha premuto, solo numeri e id
 * per il journal).
 * - Un host che `archiviaHost` rifiuta perché nel frattempo non è più archiviabile (sparito, non più offline: il freno
 *   di `archiviaHost`) si salta e torna in `saltati`: è il caso 3, non un guasto. Lo si decide rileggendo lo stato
 *   dell'host dopo il rifiuto, non dal testo dell'errore.
 * - Ogni altro errore ferma il giro: i già archiviati restano (ognuno ha la sua transazione col registro), quello che
 *   ha fallito e i seguenti restano in `hosts`, l'archivio scaduto non si cancella.
 * Tutto sincrono: fra la lettura dei candidati di chi chiama e l'ultima archiviazione nessun `await`.
 */
function archiviaElenco(d: Database.Database, daArchiviare: Candidato[], da: string): EsitoElenco {
  const archiviati: HostNominato[] = [];
  const saltati: HostNominato[] = [];
  const stato = d.prepare("SELECT status FROM hosts WHERE id = ?");
  for (const [i, c] of daArchiviare.entries()) {
    try {
      const r = archiviaHost(c.id, c.motivo, c.dettaglio, da);
      archiviati.push({ id: c.id, ip: r.ip, nome: r.nome });
    } catch (errore) {
      // Se non si riesce nemmeno a rileggere lo stato, è un guasto: si ferma col primo errore, non con quello della
      // rilettura, e chi ha premuto «Applica» riceve l'elenco per nome (m5 della revisione finale).
      let ora: { status: string | null } | undefined | "illeggibile";
      try {
        ora = stato.get(c.id) as { status: string | null } | undefined;
      } catch {
        ora = "illeggibile";
      }
      if (ora !== "illeggibile" && (!ora || ora.status !== "offline")) {
        saltati.push(nominato(c));
        continue;
      }
      return { ok: false, archiviati, saltati, nonArchiviati: daArchiviare.slice(i).map(nominato), fallito: nominato(c), errore };
    }
  }
  try {
    return { ok: true, archiviati, saltati, cancellatiDallArchivio: cancellaArchivioScaduto() };
  } catch (errore) {
    return { ok: false, archiviati, saltati, nonArchiviati: [], fallito: null, errore };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Job notturno `pulizia_host` (piano 2026-10-20, Task 5)
// ═══════════════════════════════════════════════════════════════════════════

/** Resoconto del giro notturno: solo numeri (i nomi e gli IP stanno nel registro JSONL). */
export interface EsitoPuliziaNotturna {
  archiviati: number;
  /** Candidati che a metà giro non erano più archiviabili (tornati online, spariti). */
  nonPiuArchiviabili: number;
  /** Candidati di una rete in scansione proprio adesso: la notte dopo. */
  rinviati: number;
  cancellatiDallArchivio: number;
}

/**
 * Il giro del job `pulizia_host` (acceso solo dall'interruttore, decisione 4): i candidati di adesso
 * (`candidatiPulizia`, con tutte le esclusioni), archiviati da «job», poi l'archivio oltre i 90 giorni.
 * - Un candidato su una rete che un giro di scansione tiene adesso (lucchetto in memoria, `network-scan-lock`) si
 *   rinvia alla notte dopo: il giro sta per riscrivere quegli host, e uno tolto sotto i suoi piedi diventerebbe un host
 *   nuovo o un errore della scansione. Un host assente da 60 giorni può aspettare un giorno.
 * - Un candidato che a metà giro non si può più archiviare si salta e si conta (`archiviaElenco`).
 * - Ogni altro errore ferma il giro e lancia, così lo scheduler lo conta fra i falliti e non scrive `last_run`. Il
 *   messaggio porta l'id dell'host e i numeri, mai nomi o IP: finisce nel journal.
 * Nel journal una riga di soli numeri; i nomi vanno solo nel registro JSONL (scritto da `archiviaHost` e
 * `cancellaArchivioScaduto`). Senza contesto tenant lancia (`dbCorrente`).
 */
export function runPuliziaHost(): EsitoPuliziaNotturna {
  const d = dbCorrente();
  const { candidati } = candidatiPulizia();
  const occupato = inScansione(d, candidati);
  const daArchiviare = candidati.filter((c) => !occupato(c));
  const rinviati = candidati.length - daArchiviare.length;

  const g = archiviaElenco(d, daArchiviare, "job");
  if (!g.ok) {
    const dove = g.fallito ? `all'host #${g.fallito.id}` : "alla cancellazione dell'archivio scaduto";
    throw new Error(`Pulizia notturna degli host interrotta ${dove}: ${messaggio(g.errore)} `
      + `(${g.archiviati.length} archiviati prima del guasto, ${g.nonArchiviati.length} ancora fra gli host)`, { cause: g.errore });
  }
  const esito: EsitoPuliziaNotturna = {
    archiviati: g.archiviati.length,
    nonPiuArchiviabili: g.saltati.length,
    rinviati,
    cancellatiDallArchivio: g.cancellatiDallArchivio.length,
  };
  console.info(`[Scheduler] pulizia_host: ${esito.archiviati} archiviati, ${esito.cancellatiDallArchivio} cancellati dall'archivio`
    + (esito.nonPiuArchiviabili ? `, ${esito.nonPiuArchiviabili} non più archiviabili` : "")
    + (rinviati ? `, ${rinviati} rinviati (rete in scansione)` : ""));
  return esito;
}
