/**
 * Sensore trunk (2026-10-24): VLAN, MAC, IP e nomi visti sulla porta trunk.
 *
 * Il sensore è un servizio a sé (DA-Vul-can, `sensore-trunk`), separato dalla
 * scansione: può girare anche con lo Scanner-Edge spento. Per questo DA-IPAM
 * lo legge prima dal socket Unix locale (appliance: stessa VM) e solo se lì non
 * c'è dall'API dell'edge del tenant (`/api/v1/trunk/*`, stesso token).
 *
 * Nasce spento: si legge solo con `tenant_settings.trunk_lettura = '1'`.
 * La lettura è incrementale (cursore `trunk_cursore`): ogni giro chiede solo
 * le osservazioni cambiate dopo l'ultima.
 */

import { request as httpRequest } from "node:http";
import { getCurrentTenantCode, getTenantDb, getTenantSetting, setTenantSetting } from "@/lib/db-tenant";
import { getNetworks, upsertMacIpMapping } from "@/lib/db";
import { assicuraColonnaProtocolliTrunk, assicuraColonnaServerDhcpTrunk } from "@/lib/db-tenant-schema";
import { isIpInCidr, macToHex, normalizeMacForStorage } from "@/lib/utils";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { edgeApiGet, edgeApiPost, EdgeClientError } from "@/lib/vuln/scanner-edge-client";
import { unisciReti, type TrunkMaschera } from "@/lib/trunk/reti";
import { getTipiRilievoPerMac, valutaRilievi, type TipoRilievo } from "@/lib/trunk/rilievi";
import { portaHostDalTrunk } from "@/lib/trunk/host-dal-trunk";

export const TRUNK_SOCKET_DEFAULT = "/run/sensore-trunk/api.sock";
const PAGINA = 1000;
const PAGINE_PER_GIRO = 20;

export class SensoreTrunkAssente extends Error {}

export interface TrunkOsservazione {
  id: number;
  vid: number;
  mac: string;
  ip: string;
  nome: string | null;
  fonte_nome: string | null;
  /** Nomi dei protocolli in cui è stato visto (ARP, DHCP, mDNS…): li manda il sensore. */
  protocolli?: string[] | null;
  passivo: boolean | number;
  attivo: boolean | number;
  prima_vista: string;
  ultima_vista: string;
}

export interface TrunkRete {
  vid: number;
  cidr: string;
  gateway_ip?: string | null;
  /** dhcp = gateway annunciato dal DHCP; arp/config = gateway è solo l'IP più cercato. */
  fonte?: string;
}

/** Un server DHCP visto rispondere in una VLAN (offerte e conferme che arrivano al trunk). */
export interface TrunkServerDhcp {
  mac: string;
  ip: string;
  ultima_vista: string | null;
}

export interface TrunkVlan {
  vid: number;
  vista: boolean;
  dichiarata: boolean;
  mac: number;
  ultima_vista: string | null;
  reti: TrunkRete[];
  server_dhcp?: TrunkServerDhcp[];
}

/** Un apparato di rete che si annuncia sul trunk con CDP o LLDP. */
export interface TrunkVicino {
  protocollo: string;
  sistema: string;
  porta: string;
  vid: number;
  indirizzo: string | null;
  vlan_nativa: number | null;
  ultima_vista: string;
}

interface Cursore {
  dopo: string;
  dopo_id: number;
}

type Lettore = <T>(percorso: string, params?: Record<string, string | number>) => Promise<T>;

function socketPath(): string {
  return process.env.SENSORE_TRUNK_SOCKET || TRUNK_SOCKET_DEFAULT;
}

function query(params?: Record<string, string | number>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `?${q.toString()}`;
}

/** POST sul socket Unix del sensore (corpo JSON). Stessi errori di `leggiDalSocket`. */
export function scriviSulSocket<T>(percorso: string, corpo: unknown, socket = socketPath()): Promise<T> {
  return new Promise((resolve, reject) => {
    const dati = JSON.stringify(corpo);
    const req = httpRequest(
      {
        socketPath: socket, path: percorso, method: "POST", timeout: 10_000,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(dati) },
      },
      (res) => {
        const parti: Buffer[] = [];
        res.on("data", (c: Buffer) => parti.push(c));
        res.on("end", () => {
          const testo = Buffer.concat(parti).toString("utf8");
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`sensore trunk ${res.statusCode}: ${testo.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(testo) as T);
          } catch {
            reject(new Error("sensore trunk: risposta non JSON"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("sensore trunk: tempo scaduto")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.code === "EACCES") {
        reject(new SensoreTrunkAssente(`socket ${socket}: ${e.code}`));
      } else {
        reject(e);
      }
    });
    req.end(dati);
  });
}

/**
 * Chiede al sensore un giro ARP su una rete vista (solo su richiesta di un admin).
 * Socket locale prima, poi l'edge del tenant. Ritorna il numero del giro.
 */
export async function chiediGiroArp(vid: number, cidr: string): Promise<{ id: number; fonte: "socket" | "edge" }> {
  const corpo = { vid, cidr, tipo: "arp" };
  try {
    const r = await scriviSulSocket<{ id: number }>("/giri", corpo);
    return { id: r.id, fonte: "socket" };
  } catch (e) {
    if (!(e instanceof SensoreTrunkAssente)) throw e;
  }
  const scanner = getActiveEdgeScanner();
  if (!scanner) throw new SensoreTrunkAssente("né socket locale né Scanner-Edge configurato");
  try {
    const r = await edgeApiPost<{ id: number }>(scanner, "/api/v1/trunk/giri", { vid, cidr }, { timeoutMs: 15_000 });
    return { id: r.id, fonte: "edge" };
  } catch (err) {
    if (err instanceof EdgeClientError && (err.status === 404 || err.status === 405)) {
      throw new SensoreTrunkAssente("lo Scanner-Edge non ha il sensore trunk o va aggiornato");
    }
    throw err;
  }
}

/** GET sul socket Unix del sensore. Socket assente o rifiutato → SensoreTrunkAssente. */
export function leggiDalSocket<T>(percorso: string, params?: Record<string, string | number>, socket = socketPath()): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { socketPath: socket, path: percorso + query(params), method: "GET", timeout: 10_000 },
      (res) => {
        const parti: Buffer[] = [];
        res.on("data", (c: Buffer) => parti.push(c));
        res.on("end", () => {
          const corpo = Buffer.concat(parti).toString("utf8");
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`sensore trunk ${res.statusCode}: ${corpo.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(corpo) as T);
          } catch {
            reject(new Error("sensore trunk: risposta non JSON"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("sensore trunk: tempo scaduto")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.code === "EACCES") {
        reject(new SensoreTrunkAssente(`socket ${socket}: ${e.code}`));
      } else {
        reject(e);
      }
    });
    req.end();
  });
}

/** Sceglie da dove leggere: socket locale, altrimenti l'edge del tenant. */
export async function scegliLettore(): Promise<{ fonte: "socket" | "edge"; leggi: Lettore }> {
  try {
    await leggiDalSocket("/stato");
    return { fonte: "socket", leggi: (p, params) => leggiDalSocket(p, params) };
  } catch (e) {
    if (!(e instanceof SensoreTrunkAssente)) throw e;
  }
  const scanner = getActiveEdgeScanner();
  if (!scanner) throw new SensoreTrunkAssente("né socket locale né Scanner-Edge configurato");
  const leggi: Lettore = async (p, params) => {
    try {
      return await edgeApiGet(scanner, `/api/v1/trunk${p}${query(params)}`, { timeoutMs: 15_000 });
    } catch (err) {
      if (err instanceof EdgeClientError && err.status === 404) {
        throw new SensoreTrunkAssente("lo Scanner-Edge non ha il sensore trunk");
      }
      throw err;
    }
  };
  await leggi("/stato");
  return { fonte: "edge", leggi };
}

function leggiCursore(): Cursore | null {
  const raw = getTenantSetting("trunk_cursore");
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Cursore>;
    return typeof c.dopo === "string" && typeof c.dopo_id === "number" ? { dopo: c.dopo, dopo_id: c.dopo_id } : null;
  } catch {
    return null;
  }
}

export function trunkLetturaAttiva(): boolean {
  return getTenantSetting("trunk_lettura") === "1";
}

const colonnaPronta = new WeakSet<object>();

function db() {
  const d = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
  if (!colonnaPronta.has(d)) {
    assicuraColonnaProtocolliTrunk(d);
    assicuraColonnaServerDhcpTrunk(d);
    colonnaPronta.add(d);
  }
  return d;
}

function protocolliDa(raw: string | null | undefined): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** Scrive le osservazioni (una transazione) e le passa alla tabella MAC↔IP. Ritorna le righe valide. */
export function salvaOsservazioni(righe: TrunkOsservazione[]): number {
  const d = db();
  const ins = d.prepare(`
    INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, nome, fonte_nome, protocolli, passivo, attivo, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vid, mac_normalized, ip) DO UPDATE SET
      nome = COALESCE(excluded.nome, trunk_osservazioni.nome),
      fonte_nome = COALESCE(excluded.fonte_nome, trunk_osservazioni.fonte_nome),
      protocolli = COALESCE(excluded.protocolli, trunk_osservazioni.protocolli),
      passivo = MAX(trunk_osservazioni.passivo, excluded.passivo),
      attivo = MAX(trunk_osservazioni.attivo, excluded.attivo),
      ultima_vista = MAX(trunk_osservazioni.ultima_vista, excluded.ultima_vista)
  `);
  const valide: Array<TrunkOsservazione & { display: string }> = [];
  d.transaction(() => {
    for (const r of righe) {
      const display = normalizeMacForStorage(r.mac);
      if (!display) continue;
      const protocolli = Array.isArray(r.protocolli) && r.protocolli.length ? r.protocolli.join(",") : null;
      ins.run(r.vid, macToHex(display), display, r.ip || "", r.nome || null, r.fonte_nome || null, protocolli,
        r.passivo ? 1 : 0, r.attivo ? 1 : 0, r.prima_vista, r.ultima_vista);
      valide.push({ ...r, display });
    }
  })();
  const reti = getNetworks();
  for (const r of valide) {
    if (!r.ip) continue;
    const rete = reti.find((n) => isIpInCidr(r.ip, n.cidr));
    upsertMacIpMapping({ mac: r.display, ip: r.ip, source: "arp", network_id: rete?.id ?? null, hostname: r.nome || null });
  }
  return valide.length;
}

/** Sostituisce il quadro delle VLAN (DELETE+INSERT in una transazione). */
export function salvaVlan(vlan: TrunkVlan[]): void {
  const d = db();
  const adesso = new Date().toISOString();
  d.transaction(() => {
    d.prepare("DELETE FROM trunk_vlan").run();
    const ins = d.prepare(
      "INSERT INTO trunk_vlan (vid, vista, dichiarata, mac, reti, server_dhcp, ultima_vista, aggiornato) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const v of vlan) {
      const server = (Array.isArray(v.server_dhcp) ? v.server_dhcp : [])
        .filter((x) => x && typeof x.ip === "string" && typeof x.mac === "string")
        .map((x) => ({ mac: normalizeMacForStorage(x.mac) ?? x.mac, ip: x.ip, ultima_vista: x.ultima_vista ?? null }));
      ins.run(v.vid, v.vista ? 1 : 0, v.dichiarata ? 1 : 0, v.mac ?? 0,
        JSON.stringify((v.reti ?? []).map((r) => ({ cidr: r.cidr, gateway_ip: r.gateway_ip ?? null, fonte: r.fonte ?? null }))),
        JSON.stringify(server), v.ultima_vista ?? null, adesso);
    }
  })();
}

/** Sostituisce l'elenco dei vicini CDP/LLDP (DELETE+INSERT in una transazione). */
export function salvaVicini(vicini: TrunkVicino[]): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM trunk_vicini").run();
    const ins = d.prepare(`
      INSERT OR REPLACE INTO trunk_vicini (protocollo, sistema, porta, vid, indirizzo, vlan_nativa, ultima_vista)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of vicini) {
      if (!v || typeof v.sistema !== "string" || typeof v.protocollo !== "string") continue;
      ins.run(v.protocollo, v.sistema, v.porta ?? "?", v.vid ?? 0, v.indirizzo ?? null,
        typeof v.vlan_nativa === "number" ? v.vlan_nativa : null, v.ultima_vista ?? new Date().toISOString());
    }
  })();
}

export function getTrunkVicini(): TrunkVicino[] {
  return db().prepare("SELECT * FROM trunk_vicini ORDER BY sistema, porta").all() as TrunkVicino[];
}

/**
 * I vicini li espone il socket del sensore; l'edge solo se aggiornato. Se non ci sono,
 * si va avanti senza: non è un errore della lettura.
 */
async function leggiVicini(l: { leggi: Lettore }): Promise<TrunkVicino[] | null> {
  try {
    const r = await l.leggi<{ vicini?: TrunkVicino[] }>("/vicini");
    return Array.isArray(r.vicini) ? r.vicini : [];
  } catch (e) {
    if (e instanceof SensoreTrunkAssente || (e instanceof Error && /\b404\b/.test(e.message))) return null;
    throw e;
  }
}

/**
 * Un giro di lettura: VLAN e osservazioni nuove dal cursore. Con l'interruttore
 * spento non fa niente; con il sensore assente lo dice senza errore.
 */
export async function sincronizzaTrunk(lettore?: { fonte: string; leggi: Lettore }): Promise<{ fonte?: string; osservazioni: number; vlan: number; nota?: string }> {
  if (!trunkLetturaAttiva()) return { osservazioni: 0, vlan: 0, nota: "lettura spenta" };
  try {
    const esito = await sincronizza(lettore);
    segnaEsito(esito.nota ? "assente" : "ok", esito.nota ?? `${esito.vlan} VLAN, ${esito.osservazioni} osservazioni nuove (${esito.fonte})`);
    return esito;
  } catch (e) {
    segnaEsito("errore", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export interface TrunkEsitoLettura {
  quando: string;
  esito: "ok" | "assente" | "errore";
  nota: string;
}

function segnaEsito(esito: TrunkEsitoLettura["esito"], nota: string): void {
  setTenantSetting("trunk_ultimo_esito", JSON.stringify({ quando: new Date().toISOString(), esito, nota: nota.slice(0, 300) }));
}

/** Com'è andata l'ultima lettura programmata (ogni 2 minuti): la pagina lo mostra. */
export function getTrunkUltimoEsito(): TrunkEsitoLettura | null {
  const raw = getTenantSetting("trunk_ultimo_esito");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TrunkEsitoLettura>;
    return typeof v.quando === "string" && typeof v.nota === "string" && (v.esito === "ok" || v.esito === "assente" || v.esito === "errore")
      ? { quando: v.quando, esito: v.esito, nota: v.nota }
      : null;
  } catch {
    return null;
  }
}

export interface TrunkStatoSonda {
  /** La sonda risponde (dal socket locale o dall'edge). */
  raggiungibile: boolean;
  fonte: "socket" | "edge" | null;
  nic: string | null;
  inAscolto: boolean;
  /** Ha già visto pacchetti con il tag 802.1Q: senza, la porta non è un trunk. */
  tagLetti: boolean;
  pacchettiAlSecondo: number | null;
  errore: string | null;
}

/** Chiede alla sonda come sta, in pochi secondi: la pagina non deve restare appesa. */
export async function statoSonda(attesaMs = 4_000): Promise<TrunkStatoSonda> {
  const vuoto = { fonte: null, nic: null, inAscolto: false, tagLetti: false, pacchettiAlSecondo: null };
  const prova = (async (): Promise<TrunkStatoSonda> => {
    const l = await scegliLettore();
    const s = await l.leggi<{ nic?: string; in_ascolto?: boolean; tag_letti?: boolean; pacchetti_al_secondo?: number; errore?: string | null }>("/stato");
    return {
      raggiungibile: true, fonte: l.fonte, nic: s.nic ?? null, inAscolto: !!s.in_ascolto, tagLetti: !!s.tag_letti,
      pacchettiAlSecondo: typeof s.pacchetti_al_secondo === "number" ? s.pacchetti_al_secondo : null, errore: s.errore ?? null,
    };
  })();
  const scaduto = new Promise<TrunkStatoSonda>((resolve) => {
    setTimeout(() => resolve({ raggiungibile: false, ...vuoto, errore: "la sonda non ha risposto in tempo" }), attesaMs).unref?.();
  });
  try {
    return await Promise.race([prova, scaduto]);
  } catch (e) {
    return { raggiungibile: false, ...vuoto, errore: e instanceof Error ? e.message : String(e) };
  }
}

async function sincronizza(lettore?: { fonte: string; leggi: Lettore }): Promise<{ fonte?: string; osservazioni: number; vlan: number; nota?: string }> {
  let l = lettore;
  if (!l) {
    try {
      l = await scegliLettore();
    } catch (e) {
      if (e instanceof SensoreTrunkAssente) return { osservazioni: 0, vlan: 0, nota: e.message };
      throw e;
    }
  }
  const { vlan } = await l.leggi<{ vlan: TrunkVlan[] }>("/vlan");
  salvaVlan(vlan);
  // Tabella vuota (prima lettura, o tenant importato con il cursore di un'altra istanza): da capo.
  const vuota = !db().prepare("SELECT 1 FROM trunk_osservazioni LIMIT 1").get();
  let cursore = vuota ? null : leggiCursore();
  let totale = 0;
  for (let i = 0; i < PAGINE_PER_GIRO; i++) {
    const params: Record<string, string | number> = { limite: PAGINA };
    if (cursore) {
      params.dopo = cursore.dopo;
      params.dopo_id = cursore.dopo_id;
    }
    const pagina = await l.leggi<{ osservazioni: TrunkOsservazione[]; prossimo: Cursore | null }>("/osservazioni", params);
    totale += salvaOsservazioni(pagina.osservazioni);
    const ultima = pagina.osservazioni[pagina.osservazioni.length - 1];
    if (ultima) {
      cursore = { dopo: ultima.ultima_vista, dopo_id: ultima.id };
      setTenantSetting("trunk_cursore", JSON.stringify(cursore));
    }
    if (!pagina.prossimo) break;
  }
  const vicini = await leggiVicini(l);
  if (vicini) salvaVicini(vicini);
  // Host e MAC delle reti con VLAN (27/10, mini PC dimostrativo): senza, restavano vuote.
  try {
    const h = portaHostDalTrunk();
    if (h.creati || h.mac) console.info(`[trunk] host dal trunk: ${h.creati} nuovi, ${h.mac} MAC compilati`);
  } catch (e) {
    console.warn(`[trunk] host dal trunk non portati: ${e instanceof Error ? e.message : String(e)}`);
  }
  valutaRilievi();
  return { fonte: l.fonte, osservazioni: totale, vlan: vlan.length };
}

export interface TrunkVlanRiga {
  vid: number;
  vista: number;
  dichiarata: number;
  mac: number;
  reti: TrunkRete[];
  server_dhcp: TrunkServerDhcp[];
  ultima_vista: string | null;
  aggiornato: string;
}

function elencoJson<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function getTrunkVlan(): TrunkVlanRiga[] {
  const righe = db().prepare("SELECT * FROM trunk_vlan ORDER BY vid").all() as Array<Omit<TrunkVlanRiga, "reti" | "server_dhcp"> & { reti: string; server_dhcp: string | null }>;
  return righe.map((r) => ({ ...r, reti: elencoJson<TrunkRete>(r.reti), server_dhcp: elencoJson<TrunkServerDhcp>(r.server_dhcp) }));
}

export interface TrunkOsservazioneRiga {
  id: number;
  vid: number;
  mac_display: string;
  vendor: string | null;
  ip: string;
  nome: string | null;
  fonte_nome: string | null;
  protocolli: string[];
  passivo: number;
  attivo: number;
  ultima_vista: string;
  /** Rilievi di sicurezza aperti su questo MAC (LLMNR, non in inventario…). */
  rilievi: TipoRilievo[];
}

/** Come è stato trovato: solo in ascolto, solo col giro ARP (host silenzioso), con entrambi. */
export type TrunkMetodo = "ascolto" | "giro" | "entrambi";

export function getTrunkOsservazioniPaginated(opts: {
  vid?: number | null; cidr?: string | null; q?: string; metodo?: TrunkMetodo | null; limit?: number; offset?: number;
}): { righe: TrunkOsservazioneRiga[]; totale: number } {
  const where: string[] = [];
  const par: Array<string | number> = [];
  if (opts.vid != null) {
    where.push("vid = ?");
    par.push(opts.vid);
  }
  if (opts.q?.trim()) {
    where.push("(ip LIKE ? OR mac_display LIKE ? OR nome LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    par.push(like, like, like);
  }
  if (opts.metodo === "ascolto") where.push("passivo = 1 AND attivo = 0");
  if (opts.metodo === "giro") where.push("passivo = 0 AND attivo = 1");
  if (opts.metodo === "entrambi") where.push("passivo = 1 AND attivo = 1");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const d = db();
  const colonne = "id, vid, mac_display, ip, nome, fonte_nome, protocolli, passivo, attivo, ultima_vista";
  type Grezza = Omit<TrunkOsservazioneRiga, "vendor" | "protocolli" | "rilievi"> & { protocolli: string | null };
  const completa = (grezze: Grezza[]): TrunkOsservazioneRiga[] => {
    const rilievi = getTipiRilievoPerMac(grezze.map((r) => r.mac_display));
    return grezze.map((r) => ({
      ...r, protocolli: protocolliDa(r.protocolli), vendor: lookupVendorSync(r.mac_display), rilievi: rilievi.get(r.mac_display) ?? [],
    }));
  };
  if (opts.cidr) {
    // Una subnet non si filtra in SQL: si leggono le righe della VLAN (poche centinaia) e si taglia qui.
    const tutte = (d.prepare(`SELECT ${colonne} FROM trunk_osservazioni ${w} ORDER BY ip`).all(...par) as Grezza[])
      .filter((r) => r.ip && isIpInCidr(r.ip, opts.cidr as string));
    tutte.sort((a, b) => ordinaIp(a.ip) - ordinaIp(b.ip));
    return { righe: completa(tutte.slice(offset, offset + limit)), totale: tutte.length };
  }
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM trunk_osservazioni ${w}`).get(...par) as { n: number }).n;
  const righe = d.prepare(
    `SELECT ${colonne} FROM trunk_osservazioni ${w} ORDER BY ultima_vista DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...par, limit, offset) as Grezza[];
  return { righe: completa(righe), totale };
}

export interface TrunkVlanProtocolli {
  vid: number;
  ip: number;
  protocolli: string[];
}

/** Per ogni VLAN: quanti IP e in quali protocolli si sono fatti vedere (per l'elenco delle VLAN). */
export function getTrunkVlanProtocolli(): TrunkVlanProtocolli[] {
  const righe = db().prepare(`
    SELECT vid, COUNT(DISTINCT CASE WHEN ip != '' THEN ip END) AS ip, GROUP_CONCAT(protocolli) AS p
    FROM trunk_osservazioni GROUP BY vid
  `).all() as Array<{ vid: number; ip: number; p: string | null }>;
  return righe.map((r) => ({ vid: r.vid, ip: r.ip, protocolli: [...new Set(protocolliDa(r.p))].sort() }));
}

export interface TrunkIpVisto {
  ip: string;
  mac: string;
  vendor: string | null;
  nome: string | null;
  protocolli: string[];
  passivo: number;
  attivo: number;
  prima_vista: string;
  ultima_vista: string;
}

export interface TrunkGiornoRete {
  giorno: string;
  /** IP conosciuti fino a quel giorno (cumulativo). */
  noti: number;
  nuovi: number;
  attivi: number;
}

export interface TrunkReteMatrice {
  vid: number;
  cidr: string;
  gateway_ip: string | null;
  fonte: string | null;
  /** Da dove viene la maschera: DHCP, dedotta dai /24 vicini, incerta, scritta a mano. */
  maschera: TrunkMaschera;
  /** Le reti del sensore unite qui dentro (una sola = nessuna unione). */
  blocchi: string[];
  /** La rete dedotta prima della correzione a mano: la chiave per correggerla. */
  dedotta: string;
  ip: TrunkIpVisto[];
  serie: TrunkGiornoRete[];
}

const MAX_IP_PER_RETE = 1024;

/**
 * Le reti viste nel tempo (come `matrice_reti` del sensore, ma dal DB del tenant):
 * per ogni subnet dedotta gli IP che hanno parlato e, giorno per giorno, quanti
 * erano noti, nuovi e attivi negli ultimi `giorni`.
 */
export function getTrunkMatrice(giorni = 14, oggi = new Date()): { giorni: string[]; reti: TrunkReteMatrice[] } {
  const n = Math.min(Math.max(Math.trunc(giorni) || 14, 1), 60);
  const elenco: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate() - i));
    elenco.push(d.toISOString().slice(0, 10));
  }
  const righe = db().prepare(`
    SELECT vid, ip, MAX(mac_display) AS mac, MAX(nome) AS nome, GROUP_CONCAT(protocolli) AS protocolli, MAX(passivo) AS passivo, MAX(attivo) AS attivo,
           MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
    FROM trunk_osservazioni WHERE ip != '' GROUP BY vid, ip
  `).all() as Array<Omit<TrunkIpVisto, "protocolli" | "vendor"> & { vid: number; protocolli: string | null }>;
  const perVid = new Map<number, typeof righe>();
  for (const r of righe) {
    const l = perVid.get(r.vid);
    if (l) l.push(r);
    else perVid.set(r.vid, [r]);
  }
  const reti: TrunkReteMatrice[] = [];
  const correzioni = getTrunkCorrezioniMaschera();
  for (const v of getTrunkVlan()) {
    for (const rete of unisciReti(v.vid, v.reti, correzioni)) {
      const ip = (perVid.get(v.vid) ?? []).filter((r) => isIpInCidr(r.ip, rete.cidr));
      const serie = elenco.map((giorno) => ({
        giorno,
        noti: ip.filter((r) => r.prima_vista.slice(0, 10) <= giorno).length,
        nuovi: ip.filter((r) => r.prima_vista.slice(0, 10) === giorno).length,
        attivi: ip.filter((r) => r.prima_vista.slice(0, 10) <= giorno && r.ultima_vista.slice(0, 10) >= giorno).length,
      }));
      ip.sort((a, b) => ordinaIp(a.ip) - ordinaIp(b.ip));
      reti.push({
        vid: v.vid, cidr: rete.cidr, gateway_ip: rete.gateway_ip, fonte: rete.fonte,
        maschera: rete.maschera, blocchi: rete.blocchi, dedotta: rete.dedotta,
        ip: ip.slice(0, MAX_IP_PER_RETE).map((r) => ({
          ip: r.ip, mac: r.mac, vendor: lookupVendorSync(r.mac), nome: r.nome, protocolli: [...new Set(protocolliDa(r.protocolli))], passivo: r.passivo, attivo: r.attivo, prima_vista: r.prima_vista, ultima_vista: r.ultima_vista,
        })), serie,
      });
    }
  }
  return { giorni: elenco, reti };
}

/** Maschere corrette a mano dalla pagina: `vid|rete dedotta` → prefisso. */
export function getTrunkCorrezioniMaschera(): Record<string, number> {
  const raw = getTenantSetting("trunk_maschere");
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number"),
    );
  } catch {
    return {};
  }
}

/** Corregge (o con `null` toglie la correzione) la maschera di una rete dedotta. */
export function salvaCorrezioneMaschera(vid: number, dedotta: string, prefisso: number | null): void {
  const c = getTrunkCorrezioniMaschera();
  const k = `${vid}|${dedotta}`;
  if (prefisso == null) delete c[k];
  else c[k] = prefisso;
  setTenantSetting("trunk_maschere", JSON.stringify(c));
}

function ordinaIp(ip: string): number {
  return ip.split(".").reduce((acc, p) => acc * 256 + (Number(p) || 0), 0);
}

/** Per la riga di Opzioni: quante VLAN e osservazioni ci sono e quando si è letto l'ultima volta. */
export function trunkRiepilogo(): {
  vlan: number; osservazioni: number; aggiornato: string | null; ip: number; mac: number; soloAscolto: number; soloGiro: number;
} {
  const d = db();
  const v = d.prepare("SELECT COUNT(*) AS n, MAX(aggiornato) AS a FROM trunk_vlan").get() as { n: number; a: string | null };
  const o = d.prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT mac_normalized) AS mac,
           COUNT(DISTINCT CASE WHEN ip != '' THEN vid || '/' || ip END) AS ip,
           SUM(CASE WHEN passivo = 1 AND attivo = 0 THEN 1 ELSE 0 END) AS sa,
           SUM(CASE WHEN passivo = 0 AND attivo = 1 THEN 1 ELSE 0 END) AS sg
    FROM trunk_osservazioni
  `).get() as { n: number; mac: number; ip: number; sa: number | null; sg: number | null };
  return { vlan: v.n, osservazioni: o.n, aggiornato: v.a, ip: o.ip, mac: o.mac, soloAscolto: o.sa ?? 0, soloGiro: o.sg ?? 0 };
}
