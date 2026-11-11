import type Database from "better-sqlite3";
import { etichettaVelocita } from "@/lib/scheda/porte-da-guardare";
import { ipNumero, numeroIp } from "@/lib/trunk/reti";
import { retiProposte } from "@/lib/trunk/reti-proposte";
import { trunkLetturaAttiva } from "@/lib/trunk/sensore-trunk";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { condizioneAssente } from "@/lib/hosts/assenti";
import { nelCliente, type ContestoCliente } from "../contesto";
import { nomeCategoria } from "../categorie";
import { sistemaPulito } from "../testi";
import { nomeDellaPorta } from "../porte-note";
import type { RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface ReteCliente {
  id: number;
  nome: string;
  cidr: string;
  vlan: number | null;
  inUso: number;
  totale: number;
}

export interface ReteVista {
  cidr: string;
  vlan: number | null;
  indirizzi: number;
}

export interface IndirizzoCliente {
  ip: string;
  stato: "acceso" | "spento" | "assente" | "libero";
}

export interface ApparatoCliente {
  ip: string;
  nome: string;
  cosa: string;
  acceso: boolean;
  /** Spento da più di 7 giorni, o spento senza una data. */
  assente: boolean;
  vistoIl: string | null;
  collegatoA: { switch: string; porta: string; vlan: number | null; velocita: string | null } | null;
  porteAperte: Array<{ numero: number; nome: string | null }>;
}

interface RigaRete {
  id: number;
  name: string;
  cidr: string;
  vlan_id: number | null;
  in_uso: number;
}

interface RigaHost {
  id: number;
  ip: string;
  status: string | null;
  custom_name: string | null;
  hostname: string | null;
  last_seen: string | null;
  open_ports: string | null;
  attr_category: string | null;
  attr_vendor_name: string | null;
  attr_os_name: string | null;
  device_manufacturer: string | null;
  vendor: string | null;
  os_info: string | null;
  assente: number;
}

interface RigaPorta {
  nome_switch: string | null;
  porta: string | null;
  vlan: number | null;
  speed: string | null;
}

const HOST = `id, ip, status, custom_name, hostname, last_seen, open_ports,
  attr_category, attr_vendor_name, attr_os_name, device_manufacturer, vendor, os_info,
  CASE WHEN ${condizioneAssente()} THEN 1 ELSE 0 END AS assente`;

function testo(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Indirizzi utilizzabili: 2^(32−prefisso)−2; /31 e /32 contano per intero. Rete illeggibile → 0. */
function totaleIndirizzi(cidr: string): number {
  const parti = partiCidr(cidr);
  return parti ? parti.totale : 0;
}

function partiCidr(cidr: string): { base: number; prefisso: number; totale: number } | null {
  const [ip, pref] = cidr.split("/");
  const prefisso = Number(pref);
  if (!ip || !Number.isInteger(prefisso) || prefisso < 0 || prefisso > 32) return null;
  const dim = 2 ** (32 - prefisso);
  if (!Number.isFinite(dim)) return null;
  const base = Math.floor(ipNumero(ip) / dim) * dim;
  return { base, prefisso, totale: prefisso >= 31 ? dim : dim - 2 };
}

/** Ordinate per nome. */
export function retiCliente(db: Database.Database): ReteCliente[] {
  const righe = db.prepare(`
    SELECT n.id, n.name, n.cidr, n.vlan_id,
      (SELECT COUNT(*) FROM hosts h WHERE h.network_id = n.id AND h.status = 'online') AS in_uso
    FROM networks n
    ORDER BY n.name COLLATE NOCASE
  `).all() as RigaRete[];
  return righe.map((r) => ({
    id: r.id,
    nome: r.name,
    cidr: r.cidr,
    vlan: r.vlan_id,
    inUso: r.in_uso,
    totale: totaleIndirizzi(r.cidr),
  }));
}

function hostsDellaRete(db: Database.Database, reteId: number): RigaHost[] {
  return db.prepare(`SELECT ${HOST} FROM hosts WHERE network_id = ?`).all(reteId) as RigaHost[];
}

function statoHost(host: RigaHost | undefined): IndirizzoCliente["stato"] {
  if (!host) return "libero";
  if (host.status === "online") return "acceso";
  return host.assente === 1 ? "assente" : "spento";
}

/**
 * Fino a /22, un quadretto per indirizzo utilizzabile.
 * Più grande di /22: solo gli indirizzi che hanno una riga, altrimenti la griglia non sta in pagina.
 */
export function indirizziDellaRete(db: Database.Database, reteId: number): IndirizzoCliente[] {
  const rete = db.prepare("SELECT cidr FROM networks WHERE id = ?").get(reteId) as { cidr: string } | undefined;
  if (!rete) return [];
  const hosts = hostsDellaRete(db, reteId);
  const perNumero = new Map<number, RigaHost>();
  for (const host of hosts) perNumero.set(ipNumero(host.ip), host);
  const parti = partiCidr(rete.cidr);
  if (!parti || parti.prefisso < 22) {
    return hosts
      .slice()
      .sort((a, b) => ipNumero(a.ip) - ipNumero(b.ip) || a.ip.localeCompare(b.ip))
      .map((host) => ({ ip: host.ip, stato: statoHost(host) }));
  }
  const dim = 2 ** (32 - parti.prefisso);
  const primo = parti.prefisso >= 31 ? parti.base : parti.base + 1;
  const ultimo = parti.prefisso >= 31 ? parti.base + dim - 1 : parti.base + dim - 2;
  const out: IndirizzoCliente[] = [];
  for (let n = primo; n <= ultimo; n++) {
    out.push({ ip: numeroIp(n), stato: statoHost(perNumero.get(n)) });
  }
  return out;
}

function inizialeMaiuscola(s: string): string {
  return s.charAt(0).toLocaleUpperCase("it-IT") + s.slice(1);
}

function cosaDellHost(host: RigaHost): string {
  const pezzi: string[] = [];
  const categoria = nomeCategoria(testo(host.attr_category));
  if (categoria) pezzi.push(inizialeMaiuscola(categoria));
  const produttore = testo(host.attr_vendor_name) ?? testo(host.device_manufacturer) ?? testo(host.vendor);
  if (produttore) pezzi.push(produttore);
  const sistema = sistemaPulito(testo(host.attr_os_name)) ?? sistemaPulito(testo(host.os_info));
  if (sistema) pezzi.push(sistema);
  return pezzi.length > 0 ? pezzi.join(" · ") : "Non riconosciuto";
}

function vistoIl(raw: string | null): string | null {
  const t = testo(raw);
  if (!t) return null;
  const data = parseDbDate(t);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** Numeri distinti, in ordine, al più 12. JSON illeggibile → nessuna porta. */
function porteAperte(raw: string | null): ApparatoCliente["porteAperte"] {
  if (!testo(raw)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const numeri = new Set<number>();
  for (const voce of parsed) {
    if (!voce || typeof voce !== "object" || !("port" in voce)) continue;
    const n = Number((voce as { port: unknown }).port);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) numeri.add(n);
  }
  return [...numeri]
    .sort((a, b) => a - b)
    .slice(0, 12)
    .map((numero) => ({ numero, nome: nomeDellaPorta(numero) }));
}

function collegatoA(db: Database.Database, hostId: number): ApparatoCliente["collegatoA"] {
  const porta = db.prepare(`
    SELECT nd.name AS nome_switch, sp.port_name AS porta, sp.vlan AS vlan, sp.speed AS speed
    FROM switch_ports sp
    LEFT JOIN network_devices nd ON nd.id = sp.device_id
    WHERE sp.host_id = ? AND IFNULL(sp.is_trunk, 0) = 0
    ORDER BY sp.port_name
    LIMIT 1
  `).get(hostId) as RigaPorta | undefined;
  if (!porta || !testo(porta.porta)) return null;
  return {
    switch: testo(porta.nome_switch) ?? "",
    porta: testo(porta.porta) as string,
    vlan: porta.vlan,
    velocita: etichettaVelocita(porta.speed),
  };
}

function daHost(db: Database.Database, host: RigaHost): ApparatoCliente {
  return {
    ip: host.ip,
    nome: testo(host.custom_name) ?? testo(host.hostname) ?? host.ip,
    cosa: cosaDellHost(host),
    acceso: host.status === "online",
    assente: host.assente === 1,
    vistoIl: vistoIl(host.last_seen),
    collegatoA: collegatoA(db, host.id),
    porteAperte: porteAperte(host.open_ports),
  };
}

export function apparatoCliente(db: Database.Database, ip: string): ApparatoCliente | null {
  const host = db.prepare(`SELECT ${HOST} FROM hosts WHERE ip = ? ORDER BY id LIMIT 1`).get(ip) as RigaHost | undefined;
  return host ? daHost(db, host) : null;
}

/** true per 10.0.0.0/8, 172.16.0.0/12 e 192.168.0.0/16. Il resto, anche 172.32, no. */
export function retePrivata(cidr: string): boolean {
  const parti = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.exec(cidr.trim());
  if (!parti) return false;
  const a = Number(parti[1]);
  const b = Number(parti[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

/** [] se la lettura del cavo è spenta. Va chiamata dentro il contesto del cliente. */
export function retiViste(c: ContestoCliente): ReteVista[] {
  return nelCliente(c, (db) => {
    if (!trunkLetturaAttiva()) return [];
    const cidr = (db.prepare("SELECT cidr FROM networks").all() as Array<{ cidr: string }>).map((r) => r.cidr);
    const viste = retiProposte(cidr).map((p) => ({
      cidr: p.cidr,
      vlan: p.vid > 0 ? p.vid : null,
      indirizzi: p.ip,
    }));
    return selezionaRetiViste(viste);
  });
}

/** Private, con almeno 3 indirizzi visti, le più piene prima. */
export function selezionaRetiViste(viste: ReteVista[]): ReteVista[] {
  return viste
    .filter((v) => retePrivata(v.cidr) && v.indirizzi >= 3)
    .sort((a, b) => b.indirizzi - a.indirizzi || a.cidr.localeCompare(b.cidr));
}

/** VLAN diverse, non le reti che ne hanno una. */
export function vlanDistinte(vlan: Array<number | null>): number {
  return new Set(vlan.filter((v): v is number => v != null)).size;
}

/** Al più 5 voci. Dalla sesta in poi, la quinta riassume il resto. */
export function vociRetiViste(viste: ReteVista[]): VoceAttenzione[] {
  const voce = (v: ReteVista): VoceAttenzione => ({
    gravita: "attenzione",
    testo: `Rete ${v.cidr} vista e non censita`,
    href: "/cliente/reti",
    scheda: "Reti",
  });
  if (viste.length <= 5) return viste.map(voce);
  const altre = viste.length - 4;
  return [
    ...viste.slice(0, 4).map(voce),
    {
      gravita: "attenzione",
      testo: `Altre ${altre} reti viste e non censite`,
      href: "/cliente/reti",
      scheda: "Reti",
    },
  ];
}

function contestoRiquadro(vlan: number, inUso: number): string {
  const v = `${vlan} VLAN`;
  const i = inUso === 1 ? "1 indirizzo in uso" : `${inUso} indirizzi in uso`;
  return `${v} · ${i}`;
}

function riquadroReti(c: ContestoCliente): RiquadroCliente {
  const reti = nelCliente(c, (db) => retiCliente(db));
  let aperti = 0;
  try {
    aperti = retiViste(c).length;
  } catch (e) {
    console.error("[cliente] reti viste:", e instanceof Error ? e.message : String(e));
  }
  const inUso = reti.reduce((n, r) => n + r.inUso, 0);
  return {
    numero: String(reti.length),
    contesto: contestoRiquadro(vlanDistinte(reti.map((r) => r.vlan)), inUso),
    aperti,
    stato: aperti > 0 ? "attenzione" : "a_posto",
  };
}

function attenzioneReti(c: ContestoCliente): VoceAttenzione[] {
  let viste: ReteVista[] = [];
  try {
    viste = retiViste(c);
  } catch (e) {
    console.error("[cliente] reti viste:", e instanceof Error ? e.message : String(e));
    return [];
  }
  return vociRetiViste(viste);
}

export const schedaReti: SchedaCliente = {
  id: "reti",
  titolo: "Reti",
  ordine: 10,
  icona: "Network",
  attiva: () => true,
  riquadro: riquadroReti,
  attenzione: attenzioneReti,
};
