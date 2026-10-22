/**
 * LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 4 e 5; spec `specs/2026-10-22-librenms-fonte-dati-design.md`).
 *
 * - Scrittura: una fotografia per parte nelle tabelle `librenms_*` (ADR 0027/0029). «Non so» non cancella (spec §4.2):
 *   `scriviParteLibrenms` su un esito diverso da `letto` aggiorna solo `librenms_lettura` e lancia.
 * - Giro: `giroLibrenms`, nel job `librenms_sync` già esistente, dietro l'interruttore `topologia.lettura.librenms`
 *   spento di default; spento = nemmeno il client si crea. Al più ogni 15 minuti. Solo l'API di LibreNMS locale (spec
 *   §4.1): nessun traffico nuovo verso gli apparati. Dopo la lettura si aggiungono a LibreNMS da soli, al più 5 per giro
 *   e senza `force_add` (Registro del piano, 22/10: «se l'SNMP risponde»): i vicini che LibreNMS vede ma non interroga e
 *   che corrispondono a un host di DA-IPAM, poi (Riccardo 22/10 sera: «a tutti gli oggetti SNMP verificati») gli apparati
 *   e gli host con l'SNMP verificato, tranne gli esclusi a mano («Non aggiungere a LibreNMS», `librenms_esclusione`).
 * - Letture per le rotte: i dati di un oggetto (`datiLibrenmsHost`) e i candidati del modulo (`candidatiLibrenms`).
 *
 * La mappa non legge queste tabelle (spec §4.3). Esiti e log con soli numeri e codici: nessun IP, nome o MAC (spec §4.5).
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb, getTenantSetting, livelloSchemaLibrenms, schemaEsclusioneLibrenms, setTenantSetting } from "../db-tenant";
import { normalizeName, resolveRemote } from "@/lib/topology/match";
import { haColonnaPrincipale } from "@/lib/devices/cluster-discovery";
import { chiaveEsito, letturaAccesa, oraUtc } from "@/lib/topology/letture/interruttori";
import { getIntegrationConfig } from "./config";
import { createLibreNMSClient, type RispostaGrezza } from "./librenms-api";
import {
  PERCORSI,
  esitoHttp,
  leggiApparati,
  leggiArp,
  leggiInventario,
  leggiMacPorta,
  leggiPorte,
  leggiSensori,
  leggiVicini,
  leggiVlan,
  vlanDaRiga,
  type Esito,
  type RigaApparato,
  type RigaInventario,
  type RigaPorta,
  type RigaSensore,
  type RigaVicino,
} from "./librenms-lettori";
import { addSingleHostToLibreNMS, addSingleNetworkDeviceToLibreNMS, type EsitoAggiunta } from "./librenms-sync";

export type Parte = "apparati" | "porte" | "vicini" | "vlan" | "mac_porta" | "arp" | "sensori" | "inventario";
export const PARTI: readonly Parte[] = ["apparati", "porte", "vicini", "vlan", "mac_porta", "arp", "sensori", "inventario"];

/** Minuti fra due giri (spec §3.B: «al più ogni 15 minuti»). */
export const CADENZA_MINUTI = 15;
/** Apparati il cui inventario si legge in un giro; gli altri al giro dopo (il punto in `librenms_lettura.codice`). */
export const INVENTARIO_PER_GIRO = 20;
/** Vicini non interrogati aggiunti a LibreNMS in un giro. */
export const CANDIDATI_PER_GIRO = 5;
/** Un candidato rifiutato si riprova dopo un giorno, non a ogni giro. */
const RIPROVA_RIFIUTO_ORE = 24;
/** `os` di LibreNMS che non sono apparati di rete: niente inventario fisico (piano, task 4). */
const OS_SENZA_INVENTARIO = new Set(["windows", "linux", "generic", "ping", "unix", "freebsd", "macosx"]);

function db(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

// ── Scrittura ────────────────────────────────────────────────────────────────

/** Tabella e colonne di ogni parte (i nomi dei campi delle righe dei lettori), più `letto_il`. */
const TABELLE: Readonly<Record<Exclude<Parte, "inventario">, { tabella: string; colonne: readonly string[] }>> = {
  apparati: { tabella: "librenms_apparato", colonne: ["librenms_device_id", "ip", "hostname", "sysname", "os", "hardware", "version", "serial", "status", "last_polled", "last_discovered"] },
  porte: { tabella: "librenms_porta", colonne: ["librenms_device_id", "port_id", "if_index", "if_name", "if_alias", "if_type", "oper_status", "admin_status", "speed", "mac", "vlan"] },
  vicini: { tabella: "librenms_vicino", colonne: ["librenms_device_id", "link_id", "local_port_id", "protocol", "remote_hostname", "remote_port", "remote_platform", "remote_device_id", "remote_port_id"] },
  vlan: { tabella: "librenms_vlan", colonne: ["librenms_device_id", "vlan_id", "nome"] },
  mac_porta: { tabella: "librenms_mac_porta", colonne: ["librenms_device_id", "port_id", "mac", "vlan_id", "visto_il"] },
  arp: { tabella: "librenms_arp", colonne: ["librenms_device_id", "port_id", "mac", "ip"] },
  sensori: { tabella: "librenms_sensore", colonne: ["sensor_id", "librenms_device_id", "classe", "descrizione", "valore", "limite_basso", "limite_alto", "aggiornato_il"] },
};
const COLONNE_INVENTARIO = ["librenms_device_id", "ent_index", "classe", "nome", "descrizione", "modello", "seriale", "firmware", "contenuto_in"] as const;

/** La lettura di una parte non è andata: si scrive solo quando e perché, le righe di prima restano. */
export class LetturaNonRiuscita extends Error {
  constructor(readonly parte: Parte, readonly codice: string) {
    super(`LibreNMS, ${parte}: non so (${codice})`);
    this.name = "LetturaNonRiuscita";
  }
}

function richiediSchema(): void {
  if (livelloSchemaLibrenms() < 1) throw new Error("Schema di LibreNMS assente (migrazione librenms_fonte_v21 non riuscita)");
}

function segnaNonSo(d: Database.Database, parte: Parte, codice: string, adesso: string): void {
  d.prepare(
    `INSERT INTO librenms_lettura (parte, esito, righe, letto_il, tentato_il, codice) VALUES (?, 'non_so', NULL, NULL, ?, ?)
     ON CONFLICT(parte) DO UPDATE SET esito = 'non_so', tentato_il = excluded.tentato_il, codice = excluded.codice`,
  ).run(parte, adesso, codice);
}

function segnaLetto(d: Database.Database, parte: Parte, righe: number, adesso: string, codice: string | null = null): void {
  d.prepare(
    `INSERT INTO librenms_lettura (parte, esito, righe, letto_il, tentato_il, codice) VALUES (?, 'letto', ?, ?, ?, ?)
     ON CONFLICT(parte) DO UPDATE SET esito = 'letto', righe = excluded.righe, letto_il = excluded.letto_il,
       tentato_il = excluded.tentato_il, codice = excluded.codice`,
  ).run(parte, righe, adesso, adesso, codice);
}

/**
 * Riscrive la fotografia di una parte (tutte tranne l'inventario, che è per apparato): in una transazione DELETE e INSERT
 * con `letto_il = adesso`, e la riga di `librenms_lettura`. Esito `non_so` → solo `librenms_lettura` (`tentato_il`,
 * `codice`), le righe restano, e lancia LetturaNonRiuscita. Lancia anche senza lo schema (livello < 1). Restituisce le righe.
 */
export function scriviParteLibrenms<T extends object>(parte: Exclude<Parte, "inventario">, esito: Esito<T>, adesso: string): number {
  richiediSchema();
  const d = db();
  if (esito.esito !== "letto") {
    segnaNonSo(d, parte, esito.codice, adesso);
    throw new LetturaNonRiuscita(parte, esito.codice);
  }
  const { tabella, colonne } = TABELLE[parte];
  const ins = d.prepare(`INSERT INTO ${tabella} (${colonne.join(", ")}, letto_il) VALUES (${colonne.map(() => "?").join(", ")}, ?)`);
  d.transaction(() => {
    d.prepare(`DELETE FROM ${tabella}`).run();
    for (const r of esito.righe) {
      const v = r as Record<string, unknown>;
      ins.run(...colonne.map((c) => v[c] ?? null), adesso);
    }
    segnaLetto(d, parte, esito.righe.length, adesso);
  })();
  return esito.righe.length;
}

/** L'inventario di un apparato: come `scriviParteLibrenms`, sulle sole righe di quell'apparato. Non tocca `librenms_lettura`. */
export function scriviInventarioLibrenms(librenmsDeviceId: number, esito: Esito<RigaInventario>, adesso: string): number {
  richiediSchema();
  if (esito.esito !== "letto") throw new LetturaNonRiuscita("inventario", esito.codice);
  const d = db();
  const ins = d.prepare(`INSERT INTO librenms_inventario (${COLONNE_INVENTARIO.join(", ")}, letto_il) VALUES (${COLONNE_INVENTARIO.map(() => "?").join(", ")}, ?)`);
  d.transaction(() => {
    d.prepare("DELETE FROM librenms_inventario WHERE librenms_device_id = ?").run(librenmsDeviceId);
    for (const r of esito.righe) ins.run(...COLONNE_INVENTARIO.map((c) => r[c] ?? null), adesso);
  })();
  return esito.righe.length;
}

// ── Giro ─────────────────────────────────────────────────────────────────────

export interface DipendenzeGiro {
  /** Il client (prove, script della prova a vuoto); senza, quello della configurazione di LibreNMS. */
  client?: { getRisorsa(percorso: string): Promise<RispostaGrezza> };
  adesso?: () => Date;
  /** L'aggiunta di un candidato (prove); senza, `addSingleHostToLibreNMS`. */
  aggiungiHost?: (hostId: number) => Promise<EsitoAggiunta>;
  /** L'aggiunta di un apparato con l'SNMP verificato (prove); senza, `addSingleNetworkDeviceToLibreNMS`. */
  aggiungiApparato?: (deviceId: number) => Promise<EsitoAggiunta>;
}

export interface OpzioniGiro {
  ignoraCadenza?: boolean;
  /** Default vero; la prova a vuoto lo spegne (non scrive in LibreNMS). */
  aggiungiCandidati?: boolean;
  dip?: DipendenzeGiro;
}

export type EsitoParte = { esito: "letto"; righe: number } | { esito: "non_so"; codice: string } | { esito: "saltato"; codice: string };
export type EsitoGiro =
  | { saltato: "spento" | "cadenza" | "non_configurato" | "schema" }
  | {
      parti: Record<Parte, EsitoParte>;
      inventario: { apparati: number; letti: number; non_so: number };
      /** `senza_esclusioni`: la tabella delle esclusioni manca, gli oggetti SNMP non si sono aggiunti (solo i vicini). */
      candidati: { provati: number; aggiunti: number; rifiutati: number; senza_esclusioni?: true };
      ms: number;
    };

function utcInMs(t: string): number {
  return Date.parse(`${t.replace(" ", "T")}Z`);
}

async function chiedi(client: NonNullable<DipendenzeGiro["client"]>, percorso: string): Promise<RispostaGrezza | { errore: string }> {
  try {
    return await client.getRisorsa(percorso);
  } catch (e) {
    return { errore: e instanceof Error && /timeout|abort/i.test(e.message) ? "timeout" : "rete" };
  }
}

/** Esito della lettura di una risposta: HTTP ≠ 200 o rete → «non so», altrimenti il lettore. */
function esitoDi<T>(r: RispostaGrezza | { errore: string }, lettore: (corpo: unknown) => Esito<T>): Esito<T> {
  if ("errore" in r) return { esito: "non_so", codice: r.errore };
  return esitoHttp(r.status) ?? lettore(r.corpo);
}

/**
 * Un giro di lettura di LibreNMS. Spento → `saltato: "spento"` e nessuna chiamata. Le parti in serie: una che non risponde
 * o non si capisce non ferma le altre e non cancella le sue righe. L'esito (soli numeri e codici) va in
 * `topologia.lettura.librenms.esito`. Lancia solo per un errore del DB.
 */
export async function giroLibrenms(opts: OpzioniGiro = {}): Promise<EsitoGiro> {
  if (!letturaAccesa("librenms")) return { saltato: "spento" };
  if (livelloSchemaLibrenms() < 1) return { saltato: "schema" };
  const dip = opts.dip ?? {};
  const ora = dip.adesso ?? (() => new Date());
  const d = db();

  if (!opts.ignoraCadenza) {
    const prima = d.prepare("SELECT tentato_il FROM librenms_lettura WHERE parte = 'apparati'").get() as { tentato_il: string } | undefined;
    if (prima && ora().getTime() - utcInMs(prima.tentato_il) < CADENZA_MINUTI * 60_000) return { saltato: "cadenza" };
  }

  let client = dip.client;
  if (!client) {
    const cfg = getIntegrationConfig("librenms");
    if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) return { saltato: "non_configurato" };
    client = createLibreNMSClient(cfg.url, cfg.apiToken);
  }

  const t0 = Date.now();
  const adesso = oraUtc(ora());
  const parti = {} as Record<Parte, EsitoParte>;
  const scrivi = <T extends object>(parte: Exclude<Parte, "inventario">, esito: Esito<T>): void => {
    try {
      parti[parte] = { esito: "letto", righe: scriviParteLibrenms(parte, esito, adesso) };
    } catch (e) {
      if (!(e instanceof LetturaNonRiuscita)) throw e;
      parti[parte] = { esito: "non_so", codice: e.codice };
    }
  };

  scrivi("apparati", esitoDi(await chiedi(client, PERCORSI.apparati), leggiApparati));
  if (parti.apparati.esito === "letto") {
    // Un apparato tolto da LibreNMS sparisce anche dal suo inventario (caso 3 del piano).
    d.prepare("DELETE FROM librenms_inventario WHERE librenms_device_id NOT IN (SELECT librenms_device_id FROM librenms_apparato)").run();
  }
  scrivi("porte", esitoDi(await chiedi(client, PERCORSI.porte), leggiPorte));
  scrivi("vicini", esitoDi(await chiedi(client, PERCORSI.vicini), leggiVicini));
  const vlanRisp = await chiedi(client, PERCORSI.vlan);
  scrivi("vlan", esitoDi(vlanRisp, leggiVlan));
  const vlanPerRiga = "errore" in vlanRisp || vlanRisp.status !== 200 ? new Map<number, number>() : vlanDaRiga(vlanRisp.corpo);
  scrivi("mac_porta", esitoDi(await chiedi(client, PERCORSI.mac_porta), (c) => leggiMacPorta(c, vlanPerRiga)));
  scrivi("arp", esitoDi(await chiedi(client, PERCORSI.arp), leggiArp));
  scrivi("sensori", esitoDi(await chiedi(client, PERCORSI.sensori), leggiSensori));

  const inventario = await giroInventario(d, client, adesso);
  parti.inventario = inventario.esito;

  const candidati: { provati: number; aggiunti: number; rifiutati: number; senza_esclusioni?: true } = { provati: 0, aggiunti: 0, rifiutati: 0 };
  if (opts.aggiungiCandidati !== false) {
    const aggiungiHost = dip.aggiungiHost ?? addSingleHostToLibreNMS;
    const aggiungiApparato = dip.aggiungiApparato ?? addSingleNetworkDeviceToLibreNMS;
    const limite = oraUtc(new Date(ora().getTime() - RIPROVA_RIFIUTO_ORE * 3_600_000));
    const daProvare = (r: string | null) => r === null || r < limite;
    // Senza la tabella delle esclusioni non si sa chi è escluso: gli oggetti SNMP restano fuori, i vicini no (come prima).
    const conEsclusioni = schemaEsclusioneLibrenms(d);
    if (!conEsclusioni) candidati.senza_esclusioni = true;
    const esclusi = new Set(conEsclusioni ? (d.prepare("SELECT ip FROM librenms_esclusione").all() as Array<{ ip: string }>).map((r) => r.ip) : []);
    const turno: Array<{ tipo: "host" | "apparato"; id: number; ip: string }> = [];
    const visti = new Set<string>();
    if (parti.vicini.esito === "letto") {
      for (const c of candidatiDaiVicini(d)) {
        if (esclusi.has(c.ip) || !daProvare(c.rifiutato_il) || visti.has(c.ip)) continue;
        visti.add(c.ip);
        turno.push({ tipo: "host", id: c.host_id, ip: c.ip });
      }
    }
    // Chi è già in LibreNMS si sa solo dalla fotografia degli apparati: senza, nessun oggetto SNMP (si aggiungerebbero doppi).
    if (conEsclusioni && parti.apparati.esito === "letto") {
      for (const c of candidatiSnmpVerificati(d)) {
        if (!daProvare(c.rifiutato_il) || visti.has(c.ip)) continue;
        visti.add(c.ip);
        turno.push({ tipo: c.tipo, id: c.id, ip: c.ip });
      }
    }
    for (const c of turno.slice(0, CANDIDATI_PER_GIRO)) {
      candidati.provati++;
      try {
        const e = c.tipo === "apparato" ? await aggiungiApparato(c.id) : await aggiungiHost(c.id);
        if (e.ok) candidati.aggiunti++;
        else candidati.rifiutati++;
      } catch {
        candidati.rifiutati++; // oggetto sparito o LibreNMS non configurato: si riprova al giro dopo
      }
    }
  }

  const esito: EsitoGiro = { parti, inventario: inventario.conti, candidati, ms: Date.now() - t0 };
  setTenantSetting(chiaveEsito("librenms"), JSON.stringify({ il: adesso, ...esito }));
  const letti = PARTI.filter((p) => parti[p].esito === "letto").length;
  console.info(`[librenms] lettura: ${letti}/${PARTI.length} parti lette, candidati ${candidati.aggiunti}/${candidati.provati}, ${esito.ms} ms`);
  return esito;
}

/** L'inventario di al più INVENTARIO_PER_GIRO apparati di rete, ripartendo dal punto del giro prima. */
async function giroInventario(
  d: Database.Database,
  client: NonNullable<DipendenzeGiro["client"]>,
  adesso: string,
): Promise<{ esito: EsitoParte; conti: { apparati: number; letti: number; non_so: number } }> {
  const ids = (d.prepare("SELECT librenms_device_id AS id, os FROM librenms_apparato ORDER BY librenms_device_id").all() as Array<{ id: number; os: string | null }>)
    .filter((r) => r.os !== null && !OS_SENZA_INVENTARIO.has(r.os.toLowerCase()))
    .map((r) => r.id);
  const conti = { apparati: ids.length, letti: 0, non_so: 0 };
  if (ids.length === 0) {
    segnaLetto(d, "inventario", 0, adesso, null);
    return { esito: { esito: "letto", righe: 0 }, conti };
  }
  const prima = d.prepare("SELECT codice FROM librenms_lettura WHERE parte = 'inventario'").get() as { codice: string | null } | undefined;
  const punto = Number(/^punto:(\d+)$/.exec(prima?.codice ?? "")?.[1] ?? 0);
  const dopo = ids.filter((id) => id > punto);
  const turno = [...dopo, ...ids.filter((id) => id <= punto)].slice(0, INVENTARIO_PER_GIRO);
  let ultimoCodice: string | null = null;
  for (const id of turno) {
    const e = esitoDi(await chiedi(client, PERCORSI.inventario(id)), (c) => leggiInventario(id, c));
    try {
      scriviInventarioLibrenms(id, e, adesso);
      conti.letti++;
    } catch (err) {
      if (!(err instanceof LetturaNonRiuscita)) throw err;
      conti.non_so++;
      ultimoCodice = err.codice;
    }
  }
  const righe = (d.prepare("SELECT COUNT(*) AS n FROM librenms_inventario").get() as { n: number }).n;
  const codice = `punto:${turno[turno.length - 1]}`;
  if (conti.letti === 0) {
    segnaNonSo(d, "inventario", codice, adesso);
    return { esito: { esito: "non_so", codice: ultimoCodice ?? "nessuno" }, conti };
  }
  segnaLetto(d, "inventario", righe, adesso, codice);
  return { esito: { esito: "letto", righe }, conti };
}

// ── Letture per le rotte ─────────────────────────────────────────────────────

export interface LetturaParte { esito: string; righe: number | null; letto_il: string | null; tentato_il: string | null; codice: string | null }

export function lettureLibrenms(): Record<Parte, LetturaParte> {
  const out = Object.fromEntries(PARTI.map((p) => [p, { esito: "mai", righe: null, letto_il: null, tentato_il: null, codice: null }])) as Record<Parte, LetturaParte>;
  if (livelloSchemaLibrenms() < 1) return out;
  for (const r of db().prepare("SELECT parte, esito, righe, letto_il, tentato_il, codice FROM librenms_lettura").all() as Array<LetturaParte & { parte: string }>) {
    if ((PARTI as readonly string[]).includes(r.parte)) {
      out[r.parte as Parte] = { esito: r.esito, righe: r.righe, letto_il: r.letto_il, tentato_il: r.tentato_il, codice: r.codice };
    }
  }
  return out;
}

/** Il nome di un host per le liste: il nome dato a mano, poi l'hostname, poi l'IP. */
const nomeHost = (h: { custom_name: string | null; hostname: string | null; ip: string }): string => h.custom_name || h.hostname || h.ip;

const LIMITE_LISTE = 500;

/**
 * L'apparato di LibreNMS di un host: dagli IP dell'host e del suo cluster fisico, prima quello del principale (caso 4 del
 * piano), poi l'host, poi gli altri; per IP in `librenms_apparato`, poi in `librenms_host_map`. Null se nessuno.
 */
export function apparatoLibrenmsDellHost(d: Database.Database, hostId: number): number | null {
  // Senza la colonna del principale (migrazione cluster_principale_v21 fallita) vale l'host stesso, poi gli altri.
  const principale = haColonnaPrincipale(d) ? "pd.primary_host_id" : "NULL";
  const ips = d.prepare(
    `WITH h AS (SELECT id, ip, physical_device_id FROM hosts WHERE id = ?)
     SELECT m.ip, CASE WHEN m.id = ${principale} THEN 0 WHEN m.id = h.id THEN 1 ELSE 2 END AS ordine
       FROM h JOIN hosts m ON m.id = h.id OR (h.physical_device_id IS NOT NULL AND m.physical_device_id = h.physical_device_id)
       LEFT JOIN physical_devices pd ON pd.id = h.physical_device_id
      ORDER BY ordine, m.id`,
  ).all(hostId) as Array<{ ip: string }>;
  if (ips.length === 0) return null;
  const perApparato = d.prepare("SELECT librenms_device_id AS id FROM librenms_apparato WHERE ip = ? ORDER BY librenms_device_id LIMIT 1");
  for (const { ip } of ips) {
    const r = perApparato.get(ip) as { id: number } | undefined;
    if (r) return r.id;
  }
  const perMappa = d.prepare("SELECT librenms_device_id AS id FROM librenms_host_map WHERE host_ip = ? ORDER BY network_id DESC LIMIT 1");
  for (const { ip } of ips) {
    const r = perMappa.get(ip) as { id: number } | undefined;
    if (r) return r.id;
  }
  return null;
}

export type DatiLibrenmsHost =
  | { abbinato: false; letture: Record<Parte, LetturaParte> }
  | {
      abbinato: true;
      librenms_device_id: number;
      /** null = l'apparato non è più nell'ultima fotografia di LibreNMS (caso 3 del piano). */
      apparato: (RigaApparato & { letto_il: string }) | null;
      porte: Array<RigaPorta & { letto_il: string }>;
      vicini: Array<RigaVicino & { letto_il: string; local_port_name: string | null }>;
      sensori: Array<RigaSensore & { letto_il: string }>;
      inventario: Array<RigaInventario & { letto_il: string }>;
      letture: Record<Parte, LetturaParte>;
    };

/** I dati di LibreNMS di un host (GET /api/hosts/[id]/librenms/dati). Liste con LIMIT. */
export function datiLibrenmsHost(hostId: number): DatiLibrenmsHost {
  const letture = lettureLibrenms();
  if (livelloSchemaLibrenms() < 1) return { abbinato: false, letture };
  const d = db();
  const id = apparatoLibrenmsDellHost(d, hostId);
  if (id === null) return { abbinato: false, letture };
  const apparato = (d.prepare("SELECT * FROM librenms_apparato WHERE librenms_device_id = ?").get(id) as (RigaApparato & { letto_il: string }) | undefined) ?? null;
  return {
    abbinato: true,
    librenms_device_id: id,
    apparato,
    porte: d.prepare("SELECT * FROM librenms_porta WHERE librenms_device_id = ? ORDER BY if_index, port_id LIMIT ?").all(id, LIMITE_LISTE) as Array<RigaPorta & { letto_il: string }>,
    vicini: d.prepare(
      `SELECT v.*, p.if_name AS local_port_name FROM librenms_vicino v
         LEFT JOIN librenms_porta p ON p.librenms_device_id = v.librenms_device_id AND p.port_id = v.local_port_id
        WHERE v.librenms_device_id = ? ORDER BY p.if_index, v.link_id LIMIT ?`,
    ).all(id, LIMITE_LISTE) as Array<RigaVicino & { letto_il: string; local_port_name: string | null }>,
    sensori: d.prepare("SELECT * FROM librenms_sensore WHERE librenms_device_id = ? ORDER BY classe, descrizione LIMIT ?").all(id, LIMITE_LISTE) as Array<RigaSensore & { letto_il: string }>,
    inventario: d.prepare("SELECT * FROM librenms_inventario WHERE librenms_device_id = ? ORDER BY ent_index LIMIT ?").all(id, LIMITE_LISTE) as Array<RigaInventario & { letto_il: string }>,
    letture,
  };
}

interface CandidatoVicino { host_id: number; nome: string; ip: string; visto_da: string; porta: string; rifiutato_il: string | null }

/**
 * I vicini che LibreNMS vede ma non interroga (`remote_device_id = 0`), risolti a un host di DA-IPAM per nome o IP con
 * `resolveRemote` della topologia; quelli non risolti, e gli host già in LibreNMS (per IP in `librenms_apparato` o in
 * `librenms_host_map`), non compaiono. Un host una volta sola (il primo vicino che lo vede).
 */
function candidatiDaiVicini(d: Database.Database): CandidatoVicino[] {
  const vicini = d.prepare(
    `SELECT v.remote_hostname, v.remote_port, p.if_name AS porta, COALESCE(a.sysname, a.hostname, a.ip) AS visto_da
       FROM librenms_vicino v
       LEFT JOIN librenms_porta p ON p.librenms_device_id = v.librenms_device_id AND p.port_id = v.local_port_id
       LEFT JOIN librenms_apparato a ON a.librenms_device_id = v.librenms_device_id
      WHERE v.remote_device_id = 0 AND v.remote_hostname IS NOT NULL
      ORDER BY v.librenms_device_id, v.link_id`,
  ).all() as Array<{ remote_hostname: string; remote_port: string | null; porta: string | null; visto_da: string | null }>;
  if (vicini.length === 0) return [];
  const hosts = d.prepare(
    `SELECT h.id, h.ip, h.hostname, h.custom_name, h.dns_reverse, h.dns_forward, r.il AS rifiutato_il
       FROM hosts h LEFT JOIN librenms_rifiuto r ON r.ip = h.ip
      WHERE h.ip NOT IN (SELECT ip FROM librenms_apparato WHERE ip IS NOT NULL)
        AND h.ip NOT IN (SELECT host_ip FROM librenms_host_map)`,
  ).all() as Array<{ id: number; ip: string; hostname: string | null; custom_name: string | null; dns_reverse: string | null; dns_forward: string | null; rifiutato_il: string | null }>;
  const perId = new Map(hosts.map((h) => [String(h.id), h]));
  const byName = new Map<string, string>();
  const byIp = new Map<string, string>();
  for (const h of hosts) {
    byIp.set(h.ip, String(h.id));
    for (const n of [h.custom_name, h.hostname, h.dns_reverse, h.dns_forward]) {
      if (n && n.trim()) {
        const k = normalizeName(n);
        if (k && !byName.has(k)) byName.set(k, String(h.id));
      }
    }
  }
  const visti = new Set<string>();
  const out: CandidatoVicino[] = [];
  for (const v of vicini) {
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(v.remote_hostname.trim()) ? v.remote_hostname.trim() : null;
    const id = resolveRemote({ name: v.remote_hostname, ip }, { byName, byIp });
    if (!id || visti.has(id)) continue;
    visti.add(id);
    const h = perId.get(id)!;
    out.push({ host_id: h.id, nome: nomeHost(h), ip: h.ip, visto_da: v.visto_da ?? "apparato di LibreNMS", porta: v.porta ?? v.remote_port ?? "", rifiutato_il: h.rifiutato_il });
    if (out.length >= LIMITE_LISTE) break;
  }
  return out;
}

export interface CandidatoSnmp {
  tipo: "host" | "apparato";
  /** `hosts.id` o `network_devices.id`, secondo il tipo. */
  id: number;
  host_id: number | null;
  nome: string;
  ip: string;
  rifiutato_il: string | null;
}

/**
 * Gli oggetti con l'SNMP verificato non ancora in LibreNMS (per IP in `librenms_apparato` o in `librenms_host_map`) e non
 * esclusi (Riccardo 22/10). Verificato = per un apparato un binding SNMP riuscito o la credenziale SNMP validata sul suo
 * host (sulla sede di prova i binding «riusciti» erano 4 su 16, gli altri «non provati» ma letti ogni ora); per un host
 * senza apparato la credenziale SNMP validata. Prima gli apparati. Senza la tabella delle esclusioni: lista vuota.
 */
export function candidatiSnmpVerificati(d: Database.Database): CandidatoSnmp[] {
  if (!schemaEsclusioneLibrenms(d)) return [];
  return d.prepare(
    `WITH dentro AS (SELECT ip FROM librenms_apparato WHERE ip IS NOT NULL UNION SELECT host_ip FROM librenms_host_map
                     UNION SELECT ip FROM librenms_esclusione)
     SELECT * FROM (
       SELECT 'apparato' AS tipo, nd.id, nd.host_id, nd.host AS ip, COALESCE(NULLIF(nd.name, ''), nd.host) AS nome, r.il AS rifiutato_il, 0 AS ordine
         FROM network_devices nd LEFT JOIN librenms_rifiuto r ON r.ip = nd.host
        WHERE nd.host NOT IN (SELECT ip FROM dentro)
          AND (EXISTS (SELECT 1 FROM device_credential_bindings b
                        WHERE b.device_id = nd.id AND b.protocol_type = 'snmp' AND b.test_status = 'success')
               OR EXISTS (SELECT 1 FROM host_credentials hc JOIN hosts h ON h.id = hc.host_id
                           WHERE (h.id = nd.host_id OR h.ip = nd.host) AND hc.protocol_type = 'snmp' AND hc.validated = 1))
       UNION ALL
       SELECT 'host', h.id, h.id, h.ip, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, ''), h.ip), r.il, 1
         FROM hosts h LEFT JOIN librenms_rifiuto r ON r.ip = h.ip
        WHERE h.ip NOT IN (SELECT ip FROM dentro)
          AND EXISTS (SELECT 1 FROM host_credentials hc WHERE hc.host_id = h.id AND hc.protocol_type = 'snmp' AND hc.validated = 1)
          AND NOT EXISTS (SELECT 1 FROM network_devices nd WHERE nd.host_id = h.id OR nd.host = h.ip)
     ) ORDER BY ordine, id LIMIT ?`,
  ).all(LIMITE_LISTE) as CandidatoSnmp[];
}

/** Lo stato dell'aggiunta automatica di un oggetto, per la scheda (null senza schema di LibreNMS). */
export interface StatoAggiuntaLibrenms {
  /** SNMP verificato con lo stesso criterio dei candidati: apparato con binding riuscito o host con SNMP validata. */
  snmp_verificato: boolean;
  escluso_il: string | null;
  rifiuto: { codice: string; motivo: string; il: string } | null;
  /** Le esclusioni si possono scrivere (migrazione `librenms_esclusione_v21` riuscita). */
  esclusioni: boolean;
}

export function statoAggiuntaLibrenms(hostId: number): StatoAggiuntaLibrenms | null {
  if (livelloSchemaLibrenms() < 1) return null;
  const d = db();
  const h = d.prepare("SELECT ip FROM hosts WHERE id = ?").get(hostId) as { ip: string } | undefined;
  if (!h) return null;
  const verificato = !!d.prepare(
    `SELECT 1 FROM host_credentials WHERE host_id = ? AND protocol_type = 'snmp' AND validated = 1
     UNION ALL
     SELECT 1 FROM network_devices nd JOIN device_credential_bindings b ON b.device_id = nd.id
      WHERE (nd.host_id = ? OR nd.host = ?) AND b.protocol_type = 'snmp' AND b.test_status = 'success'
     LIMIT 1`,
  ).get(hostId, hostId, h.ip);
  const esclusioni = schemaEsclusioneLibrenms(d);
  const escluso = esclusioni ? (d.prepare("SELECT il FROM librenms_esclusione WHERE ip = ?").get(h.ip) as { il: string } | undefined) : undefined;
  const rifiuto = d.prepare("SELECT codice, motivo, il FROM librenms_rifiuto WHERE ip = ?").get(h.ip) as { codice: string; motivo: string; il: string } | undefined;
  return { snmp_verificato: verificato, escluso_il: escluso?.il ?? null, rifiuto: rifiuto ?? null, esclusioni };
}

export interface CandidatiLibrenms {
  non_interrogati: Array<{ host_id: number | null; nome: string; ip: string; dal: string | null }>;
  rifiutati: Array<{ host_id: number | null; nome: string; ip: string; codice: string; motivo: string; il: string }>;
  dai_vicini: Array<{ host_id: number; nome: string; ip: string; visto_da: string; porta: string }>;
  /** Oggetti con l'SNMP verificato in attesa dell'aggiunta automatica (5 per giro). */
  snmp_verificati: Array<{ tipo: "host" | "apparato"; host_id: number | null; nome: string; ip: string; rifiutato_il: string | null }>;
  /** Esclusi a mano dall'aggiunta automatica. */
  esclusi: Array<{ host_id: number | null; nome: string; ip: string; il: string }>;
}

/**
 * Le tre liste della pagina del modulo (GET /api/integrations/librenms/candidati): apparati in LibreNMS mai interrogati
 * (`last_polled` nullo, mai tolti da soli: spec §3.A), aggiunte rifiutate col motivo, vicini da aggiungere. LIMIT 500.
 */
export function candidatiLibrenms(): CandidatiLibrenms {
  if (livelloSchemaLibrenms() < 1) return { non_interrogati: [], rifiutati: [], dai_vicini: [], snmp_verificati: [], esclusi: [] };
  const d = db();
  const nonInterrogati = d.prepare(
    `SELECT a.ip, COALESCE(a.sysname, a.hostname, a.ip) AS nome_librenms, a.last_discovered AS dal,
            (SELECT h.id FROM hosts h WHERE h.ip = a.ip ORDER BY h.id LIMIT 1) AS host_id,
            (SELECT COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, '')) FROM hosts h WHERE h.ip = a.ip ORDER BY h.id LIMIT 1) AS nome_host
       FROM librenms_apparato a WHERE a.last_polled IS NULL ORDER BY a.librenms_device_id LIMIT ?`,
  ).all(LIMITE_LISTE) as Array<{ ip: string | null; nome_librenms: string | null; dal: string | null; host_id: number | null; nome_host: string | null }>;
  const rifiutati = d.prepare(
    `SELECT r.ip, r.codice, r.motivo, r.il, COALESCE(r.host_id, nd.host_id) AS host_id,
            COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, ''), nd.name, r.ip) AS nome
       FROM librenms_rifiuto r
       LEFT JOIN network_devices nd ON nd.id = r.network_device_id
       LEFT JOIN hosts h ON h.id = COALESCE(r.host_id, nd.host_id)
      ORDER BY r.il DESC LIMIT ?`,
  ).all(LIMITE_LISTE) as Array<{ ip: string; codice: string; motivo: string; il: string; host_id: number | null; nome: string }>;
  const esclusi = schemaEsclusioneLibrenms(d)
    ? d.prepare(
      `SELECT e.ip, e.il, COALESCE(e.host_id, nd.host_id) AS host_id,
              COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, ''), nd.name, e.ip) AS nome
         FROM librenms_esclusione e
         LEFT JOIN network_devices nd ON nd.id = e.network_device_id
         LEFT JOIN hosts h ON h.id = COALESCE(e.host_id, nd.host_id)
        ORDER BY e.il DESC LIMIT ?`,
    ).all(LIMITE_LISTE) as Array<{ ip: string; il: string; host_id: number | null; nome: string }>
    : [];
  return {
    non_interrogati: nonInterrogati.map((r) => ({ host_id: r.host_id, nome: r.nome_host ?? r.nome_librenms ?? r.ip ?? "?", ip: r.ip ?? "", dal: r.dal })),
    rifiutati,
    dai_vicini: candidatiDaiVicini(d).map((c) => ({ host_id: c.host_id, nome: c.nome, ip: c.ip, visto_da: c.visto_da, porta: c.porta })),
    snmp_verificati: candidatiSnmpVerificati(d).map((c) => ({ tipo: c.tipo, host_id: c.host_id, nome: c.nome, ip: c.ip, rifiutato_il: c.rifiutato_il })),
    esclusi,
  };
}

/** L'esito dell'ultimo giro, per la pagina del modulo (null se mai girato o illeggibile). */
export function ultimoGiroLibrenms(): Record<string, unknown> | null {
  const t = getTenantSetting(chiaveEsito("librenms"));
  if (!t) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
