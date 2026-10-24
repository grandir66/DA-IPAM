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
import { isIpInCidr, macToHex, normalizeMacForStorage } from "@/lib/utils";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { edgeApiGet, EdgeClientError } from "@/lib/vuln/scanner-edge-client";

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
  passivo: boolean | number;
  attivo: boolean | number;
  prima_vista: string;
  ultima_vista: string;
}

export interface TrunkRete {
  vid: number;
  cidr: string;
  gateway_ip?: string | null;
}

export interface TrunkVlan {
  vid: number;
  vista: boolean;
  dichiarata: boolean;
  mac: number;
  ultima_vista: string | null;
  reti: TrunkRete[];
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

function db() {
  return getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
}

/** Scrive le osservazioni (una transazione) e le passa alla tabella MAC↔IP. Ritorna le righe valide. */
export function salvaOsservazioni(righe: TrunkOsservazione[]): number {
  const d = db();
  const ins = d.prepare(`
    INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, nome, fonte_nome, passivo, attivo, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vid, mac_normalized, ip) DO UPDATE SET
      nome = COALESCE(excluded.nome, trunk_osservazioni.nome),
      fonte_nome = COALESCE(excluded.fonte_nome, trunk_osservazioni.fonte_nome),
      passivo = MAX(trunk_osservazioni.passivo, excluded.passivo),
      attivo = MAX(trunk_osservazioni.attivo, excluded.attivo),
      ultima_vista = MAX(trunk_osservazioni.ultima_vista, excluded.ultima_vista)
  `);
  const valide: Array<TrunkOsservazione & { display: string }> = [];
  d.transaction(() => {
    for (const r of righe) {
      const display = normalizeMacForStorage(r.mac);
      if (!display) continue;
      ins.run(r.vid, macToHex(display), display, r.ip || "", r.nome || null, r.fonte_nome || null,
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
      "INSERT INTO trunk_vlan (vid, vista, dichiarata, mac, reti, ultima_vista, aggiornato) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const v of vlan) {
      ins.run(v.vid, v.vista ? 1 : 0, v.dichiarata ? 1 : 0, v.mac ?? 0,
        JSON.stringify((v.reti ?? []).map((r) => ({ cidr: r.cidr, gateway_ip: r.gateway_ip ?? null }))),
        v.ultima_vista ?? null, adesso);
    }
  })();
}

/**
 * Un giro di lettura: VLAN e osservazioni nuove dal cursore. Con l'interruttore
 * spento non fa niente; con il sensore assente lo dice senza errore.
 */
export async function sincronizzaTrunk(lettore?: { fonte: string; leggi: Lettore }): Promise<{ fonte?: string; osservazioni: number; vlan: number; nota?: string }> {
  if (!trunkLetturaAttiva()) return { osservazioni: 0, vlan: 0, nota: "lettura spenta" };
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
  return { fonte: l.fonte, osservazioni: totale, vlan: vlan.length };
}

export interface TrunkVlanRiga {
  vid: number;
  vista: number;
  dichiarata: number;
  mac: number;
  reti: TrunkRete[];
  ultima_vista: string | null;
  aggiornato: string;
}

export function getTrunkVlan(): TrunkVlanRiga[] {
  const righe = db().prepare("SELECT * FROM trunk_vlan ORDER BY vid").all() as Array<Omit<TrunkVlanRiga, "reti"> & { reti: string }>;
  return righe.map((r) => {
    let reti: TrunkRete[] = [];
    try {
      reti = JSON.parse(r.reti) as TrunkRete[];
    } catch {
      reti = [];
    }
    return { ...r, reti };
  });
}

export interface TrunkOsservazioneRiga {
  id: number;
  vid: number;
  mac_display: string;
  ip: string;
  nome: string | null;
  fonte_nome: string | null;
  passivo: number;
  attivo: number;
  ultima_vista: string;
}

export function getTrunkOsservazioniPaginated(opts: { vid?: number | null; q?: string; limit?: number; offset?: number }): { righe: TrunkOsservazioneRiga[]; totale: number } {
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
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const d = db();
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM trunk_osservazioni ${w}`).get(...par) as { n: number }).n;
  const righe = d.prepare(
    `SELECT id, vid, mac_display, ip, nome, fonte_nome, passivo, attivo, ultima_vista FROM trunk_osservazioni ${w} ORDER BY ultima_vista DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...par, limit, offset) as TrunkOsservazioneRiga[];
  return { righe, totale };
}
