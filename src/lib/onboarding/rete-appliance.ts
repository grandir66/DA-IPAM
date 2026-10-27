/**
 * La rete su cui è installata l'appliance, proposta come prima subnet del
 * wizard (Riccardo, 24/10): «la network di installazione dovrebbe essere
 * proposta in modo automatico, con tutti i dati compilati sulla base di quelli
 * dell'appliance». Prima la subnet partiva vuota e il tecnico ricopiava a mano
 * CIDR, gateway e DNS che la macchina conosce già.
 *
 * Modulo puro: riceve interfacce, tabella delle rotte (`/proc/net/route`) e
 * `resolv.conf` come testo; la lettura vera sta in `rete-appliance-server.ts`.
 * Una proposta, non una scrittura: il wizard la mostra nei campi e la salva
 * solo con «Crea rete».
 */

export interface IndirizzoInterfaccia {
  address: string;
  netmask: string;
  family: string | number;
  internal: boolean;
}

export type Interfacce = Readonly<Record<string, readonly IndirizzoInterfaccia[] | undefined>>;

export interface ReteAppliance {
  /** Interfaccia da cui viene la proposta (es. `eth0`). */
  interfaccia: string;
  /** IP dell'appliance su quell'interfaccia. */
  ip: string;
  /** Rete in forma `192.168.1.0/24`. */
  cidr: string;
  /** Gateway predefinito, solo se sta dentro la rete. */
  gateway: string | null;
  /** DNS letti da resolv.conf, senza quelli locali (127.x, ::1). */
  dns: string[];
  /** Dominio di ricerca (`search`/`domain` di resolv.conf), se c'è. */
  dominio: string | null;
}

export interface FontiReteAppliance {
  interfacce: Interfacce;
  /** Contenuto di `/proc/net/route`; null = non letto. */
  rotte: string | null;
  /** Contenuti dei resolv.conf da provare in ordine; il primo con DNS non locali vince. */
  resolv: readonly (string | null)[];
  /** `APPLIANCE_LAN_IP` scritto dall'installatore: se è su un'interfaccia, vince. */
  ipDichiarato?: string | null;
}

/**
 * Interfacce che non sono la LAN del cliente: Docker, bridge di container,
 * overlay (NetBird `wt0`, WireGuard, Tailscale, ZeroTier), tunnel.
 */
const INTERFACCE_ESCLUSE = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|cali|vxlan|wt\d|wg\d|tailscale|zt|tun|tap|dummy)/i;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4ANumero(ip: string): number | null {
  const m = IPV4.exec(ip.trim());
  if (!m) return null;
  const parti = m.slice(1).map(Number);
  if (parti.some((p) => p > 255)) return null;
  return ((parti[0] << 24) | (parti[1] << 16) | (parti[2] << 8) | parti[3]) >>> 0;
}

function numeroAIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function eIpv4(i: IndirizzoInterfaccia): boolean {
  return i.family === "IPv4" || i.family === 4;
}

/** Bit a 1 della maschera, o null se la maschera non è contigua. */
function prefissoDaMaschera(maschera: string): number | null {
  const n = ipv4ANumero(maschera);
  if (n == null) return null;
  let prefisso = 0;
  while (prefisso < 32 && (n & (0x80000000 >>> prefisso)) !== 0) prefisso++;
  const attesa = prefisso === 0 ? 0 : (0xffffffff << (32 - prefisso)) >>> 0;
  return attesa === n ? prefisso : null;
}

/** `192.168.1.37` + `255.255.255.0` → `192.168.1.0/24`. */
export function cidrDaIndirizzo(ip: string, maschera: string): string | null {
  const n = ipv4ANumero(ip);
  const prefisso = prefissoDaMaschera(maschera);
  if (n == null || prefisso == null || prefisso === 0) return null;
  const m = (0xffffffff << (32 - prefisso)) >>> 0;
  return `${numeroAIpv4((n & m) >>> 0)}/${prefisso}`;
}

export function ipDentroCidr(ip: string, cidr: string): boolean {
  const [rete, p] = cidr.split("/");
  const n = ipv4ANumero(ip);
  const r = ipv4ANumero(rete ?? "");
  const prefisso = Number(p);
  if (n == null || r == null || !Number.isInteger(prefisso) || prefisso < 1 || prefisso > 32) return false;
  const m = (0xffffffff << (32 - prefisso)) >>> 0;
  return ((n & m) >>> 0) === ((r & m) >>> 0);
}

/** Esadecimale little-endian di `/proc/net/route` (`0101A8C0`) → `192.168.1.1`. */
function ipDaEsadecimale(hex: string): string | null {
  if (!/^[0-9a-f]{8}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24].join(".");
}

export interface RottaPredefinita {
  interfaccia: string;
  gateway: string;
  metrica: number;
}

/** Rotte predefinite (destinazione e maschera 0) con gateway, dalla metrica più bassa. */
export function rottePredefinite(procNetRoute: string | null): RottaPredefinita[] {
  if (!procNetRoute) return [];
  const out: RottaPredefinita[] = [];
  for (const riga of procNetRoute.split("\n").slice(1)) {
    const c = riga.trim().split(/\s+/);
    if (c.length < 8) continue;
    const [interfaccia, destinazione, gw, flag, , , metrica, maschera] = c;
    // RTF_UP (1) e RTF_GATEWAY (2): una rotta spenta o senza gateway non è quella che ci serve.
    if ((parseInt(flag, 16) & 3) !== 3) continue;
    if (destinazione !== "00000000" || maschera !== "00000000") continue;
    const gateway = ipDaEsadecimale(gw);
    if (!gateway || gateway === "0.0.0.0") continue;
    out.push({ interfaccia, gateway, metrica: Number(metrica) || 0 });
  }
  return out.sort((a, b) => a.metrica - b.metrica);
}

function eLocale(ip: string): boolean {
  return /^127\./.test(ip) || ip === "::1" || ip === "0.0.0.0";
}

/** DNS e dominio di un resolv.conf; i DNS locali (systemd-resolved 127.0.0.53) si saltano. */
export function leggiResolvConf(testo: string | null): { dns: string[]; dominio: string | null } {
  const dns: string[] = [];
  let dominio: string | null = null;
  if (!testo) return { dns, dominio };
  for (const grezza of testo.split("\n")) {
    const riga = grezza.replace(/[#;].*$/, "").trim();
    const [chiave, ...valori] = riga.split(/\s+/);
    if (chiave === "nameserver" && valori[0]) {
      const ip = valori[0];
      if (ipv4ANumero(ip) != null && !eLocale(ip) && !dns.includes(ip)) dns.push(ip);
    } else if ((chiave === "search" || chiave === "domain") && valori[0] && dominio == null) {
      const d = valori[0].replace(/\.$/, "");
      if (d && d !== "." && !/^(localdomain|local)$/i.test(d)) dominio = d;
    }
  }
  return { dns, dominio };
}

interface Candidata {
  interfaccia: string;
  ip: string;
  cidr: string;
}

function candidate(interfacce: Interfacce): Candidata[] {
  const out: Candidata[] = [];
  for (const [nome, indirizzi] of Object.entries(interfacce)) {
    if (INTERFACCE_ESCLUSE.test(nome)) continue;
    for (const i of indirizzi ?? []) {
      if (i.internal || !eIpv4(i)) continue;
      // Link-local (169.254): nessun DHCP ha risposto, non è la rete del cliente.
      if (/^169\.254\./.test(i.address)) continue;
      const cidr = cidrDaIndirizzo(i.address, i.netmask);
      if (cidr) out.push({ interfaccia: nome, ip: i.address, cidr });
    }
  }
  return out;
}

/**
 * La rete da proporre: quella dell'IP dichiarato dall'installatore, altrimenti
 * quella dell'interfaccia con la rotta predefinita, altrimenti la prima LAN.
 * null = nessuna interfaccia che somigli alla LAN del cliente.
 */
export function propostaReteAppliance(f: FontiReteAppliance): ReteAppliance | null {
  const tutte = candidate(f.interfacce);
  if (tutte.length === 0) return null;
  const rotte = rottePredefinite(f.rotte);
  const dichiarato = f.ipDichiarato?.trim();
  const scelta =
    (dichiarato ? tutte.find((c) => c.ip === dichiarato) : undefined) ??
    rotte.map((r) => tutte.find((c) => c.interfaccia === r.interfaccia)).find((c) => c != null) ??
    tutte[0];

  // Il gateway vale solo se sta nella rete proposta: una rotta di un'altra
  // interfaccia non è il router di questa LAN.
  const gateway =
    rotte.find((r) => r.interfaccia === scelta.interfaccia && ipDentroCidr(r.gateway, scelta.cidr))?.gateway ??
    rotte.find((r) => ipDentroCidr(r.gateway, scelta.cidr))?.gateway ??
    null;

  let dns: string[] = [];
  let dominio: string | null = null;
  for (const testo of f.resolv) {
    const letto = leggiResolvConf(testo);
    dominio ??= letto.dominio;
    if (letto.dns.length > 0) {
      dns = letto.dns;
      dominio = letto.dominio ?? dominio;
      break;
    }
  }

  return { interfaccia: scelta.interfaccia, ip: scelta.ip, cidr: scelta.cidr, gateway, dns, dominio };
}

/** `corp.local` → `DC=corp,DC=local`: il Base DN proposto per Active Directory dal dominio di ricerca. */
export function baseDnDaDominio(dominio: string): string {
  return dominio
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `DC=${p}`)
    .join(",");
}

/** Campi della prima subnet proposti dall'appliance: il primo DNS (la rete ne accetta uno). */
export function campiReteProposti(r: ReteAppliance): { cidr: string; gateway: string; dns: string } {
  return { cidr: r.cidr, gateway: r.gateway ?? "", dns: r.dns[0] ?? "" };
}
