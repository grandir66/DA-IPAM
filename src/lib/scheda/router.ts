/**
 * Pezzi puri della scheda router e firewall (21/10): uscite internet dalle rotte default, pool DHCP più pieno,
 * interfacce in Panoramica, caselle della striscia. Modulo puro (niente DB, niente React): un dato che non c'è
 * non produce una casella con un «—».
 */
import type { Casella } from "@/components/scheda/striscia-numeri";

/** Un'interfaccia come la restituisce GET /api/devices/[id]/interfacce. */
export interface InterfacciaScheda {
  ifname: string;
  alias: string | null;
  stato: "up" | "down" | "unknown";
  velocita_mbps: number | null;
  tipo: string | null;
  mac: string | null;
  indirizzi: { ip: string; prefisso: number | null; famiglia: 4 | 6 }[];
}

/** Una riga di `routing_table` quanto serve qui: `active` assente = il dato non dice, si conta attiva. */
export interface RottaScheda {
  destination?: string | null;
  gateway?: string | null;
  interface_name?: string | null;
  active?: number | boolean | null;
}

export const SOGLIA_POOL = 85;

export function eRottaDefault(r: RottaScheda): boolean {
  const d = (r.destination ?? "").trim();
  return d === "0.0.0.0/0" || d === "::/0";
}

const attiva = (r: RottaScheda): boolean => r.active == null || r.active === true || r.active === 1;

export function usciteDefault(rotte: RottaScheda[]): { attive: number; totali: number; via: string | null } {
  const def = rotte.filter(eRottaDefault);
  const att = def.filter(attiva);
  return { attive: att.length, totali: def.length, via: att[0]?.gateway ?? att[0]?.interface_name ?? null };
}

// ── IPv4 ────────────────────────────────────────────────────────────────

function ipv4ANumero(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

function nellaRete(ip: string, base: string, prefisso: number): boolean {
  const a = ipv4ANumero(ip);
  const b = ipv4ANumero(base);
  if (a == null || b == null || prefisso < 0 || prefisso > 32) return false;
  const dim = 2 ** (32 - prefisso);
  return Math.floor(a / dim) === Math.floor(b / dim);
}

/** Quanti indirizzi copre il `ranges` di un pool MikroTik: «a-b[,c-d]», un IP solo o un CIDR. Illeggibile = 0. */
export function dimensioneRanges(ranges: string): number {
  let tot = 0;
  for (const parte of ranges.split(",").map((s) => s.trim()).filter(Boolean)) {
    const cidr = /^(.+)\/(\d{1,2})$/.exec(parte);
    if (cidr) {
      if (ipv4ANumero(cidr[1]) == null || Number(cidr[2]) > 32) continue;
      tot += 2 ** (32 - Number(cidr[2]));
      continue;
    }
    const [da, a] = parte.split("-").map((s) => s.trim());
    const n1 = ipv4ANumero(da);
    if (n1 == null) continue;
    if (a === undefined) { tot += 1; continue; }
    const n2 = ipv4ANumero(a);
    if (n2 != null && n2 >= n1) tot += n2 - n1 + 1;
  }
  return tot;
}

// ── DHCP ────────────────────────────────────────────────────────────────

export interface ServerDhcp { name: string; interface: string; addressPool: string; disabled: boolean }
export interface PoolDhcp { name: string; ranges: string }
export interface UsoPool { server: string; interfaccia: string; usati: number; totale: number; percento: number }

/**
 * Uso dei pool per server DHCP attivo: lease noti del server su indirizzi del suo pool, dal più pieno.
 * Un server spento o con un pool che non si legge (es. solo lease statici) non entra.
 */
export function poolDhcp(servers: ServerDhcp[], pools: PoolDhcp[], leasePerServer: Record<string, number>): UsoPool[] {
  const r: UsoPool[] = [];
  for (const s of servers) {
    if (s.disabled) continue;
    const pool = pools.find((p) => p.name === s.addressPool);
    const totale = pool ? dimensioneRanges(pool.ranges) : 0;
    if (totale <= 0) continue;
    const usati = leasePerServer[s.name] ?? 0;
    r.push({ server: s.name, interfaccia: s.interface, usati, totale, percento: Math.min(100, Math.round((usati / totale) * 100)) });
  }
  return r.sort((a, b) => b.percento - a.percento);
}

// ── Interfacce ──────────────────────────────────────────────────────────

/** Uscita = interfaccia nominata da una default attiva, o nella cui rete sta il gateway di una default attiva. */
function eUscita(i: InterfacciaScheda, rotte: RottaScheda[]): boolean {
  return rotte.filter((r) => eRottaDefault(r) && attiva(r)).some((r) =>
    (r.interface_name != null && r.interface_name === i.ifname) ||
    (r.gateway != null && i.indirizzi.some((a) => a.famiglia === 4 && a.prefisso != null && nellaRete(r.gateway as string, a.ip, a.prefisso))));
}

/** Le interfacce da mostrare in Panoramica: prima le uscite su, poi le su, poi le giù con indirizzo, poi il resto; a parità l'ordine di lettura. */
export function interfaccePanoramica(lista: InterfacciaScheda[], rotte: RottaScheda[], max = 8): { i: InterfacciaScheda; uscita: boolean }[] {
  const peso = (x: { i: InterfacciaScheda; uscita: boolean }) => (x.i.stato === "up" ? (x.uscita ? 0 : 1) : x.uscita ? 2 : x.i.indirizzi.length > 0 ? 3 : 4);
  return lista
    .map((i, n) => ({ i, uscita: eUscita(i, rotte), n }))
    .sort((a, b) => peso(a) - peso(b) || a.n - b.n)
    .slice(0, max)
    .map(({ i, uscita }) => ({ i, uscita }));
}

export function contaInterfacce(lista: InterfacciaScheda[]): { su: number; totale: number; vlan: number } {
  return {
    su: lista.filter((i) => i.stato === "up").length,
    totale: lista.length,
    vlan: lista.filter((i) => (i.tipo ?? "").toLowerCase() === "vlan" || /^vlan/i.test(i.ifname)).length,
  };
}

// ── Striscia ────────────────────────────────────────────────────────────

export interface ConteggiRegole { filter: number | null; nat: number | null; mangle: number | null }

/** Caselle della striscia: solo quelle di cui c'è il dato (interfacce, rotte, conteggi MikroTik, pool, uptime). */
export function caselleRouter(i: {
  interfacce: InterfacciaScheda[] | null;
  rotte: RottaScheda[];
  regole: ConteggiRegole | null;
  pool: UsoPool[];
  acceso: string | null;
}): Casella[] {
  const c: Casella[] = [];
  const u = usciteDefault(i.rotte);
  if (u.totali > 0) {
    c.push({ etichetta: "Uscite internet", valore: `${u.attive} / ${u.totali}`, ...(u.via ? { sotto: `via ${u.via}` } : {}), ...(u.attive === 0 ? { attenzione: true } : {}), tab: "routing" });
  }
  if (i.interfacce && i.interfacce.length > 0) {
    const n = contaInterfacce(i.interfacce);
    c.push({ etichetta: "Interfacce su", valore: `${n.su} / ${n.totale}`, ...(n.vlan > 0 ? { sotto: `${n.vlan} VLAN` } : {}), tab: "interfacce" });
  }
  const g = i.regole;
  if (g && (g.filter != null || g.nat != null || g.mangle != null)) {
    c.push({ etichetta: "Regole", valore: [g.filter, g.nat, g.mangle].map((x) => (x == null ? "—" : String(x))).join(" · "), sotto: "filter · NAT · mangle", tab: "configurazione" });
  }
  const p = i.pool[0];
  if (p) {
    c.push({ etichetta: `DHCP ${p.server}`, valore: `${p.usati} / ${p.totale}`, ...(p.percento >= SOGLIA_POOL ? { sotto: "pool quasi pieno", attenzione: true } : { sotto: `${p.percento}%` }), tab: "dhcp" });
  }
  if (i.rotte.length > 0) {
    c.push({ etichetta: "Rotte", valore: String(i.rotte.length), ...(u.via ? { sotto: `default via ${u.via}` } : {}), tab: "routing" });
  }
  if (i.acceso) c.push({ etichetta: "Acceso da", valore: i.acceso });
  return c;
}
