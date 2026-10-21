/**
 * Dispositivi visti dal router MikroTik (21/10, tab «Dispositivi»): ARP, lease DHCP, vicini e host IPAM uniti per IP
 * con le regole del Manager (censimento §1.11). Modulo puro: le quattro letture le fa `ingressoDispositivi`
 * (db-tenant.ts), il produttore da MAC lo passa chi chiama.
 *
 * Precedenze: MAC DHCP > ARP > LLDP; nome DHCP > LLDP > DNS. Un'ARP «failed» si scarta se nessun'altra fonte conferma
 * l'IP. Un IP non IPv4 ben formato si scarta; un MAC che non ha 12 cifre esadecimali si scarta (la riga resta).
 */
import { parseDbDate } from "@/lib/db-date";

export type FonteNome = "dhcp" | "lldp" | "dns";

export interface IngressoDispositivi {
  arp: { ip: string | null; mac: string; interface_name: string | null; status: string | null; timestamp: string | null }[];
  lease: { ip_address: string; mac_address: string; hostname: string | null; dynamic_lease: number | null; description: string | null; last_seen: string | null }[];
  vicini: { remote_ip: string | null; remote_mac: string | null; remote_device_name: string | null; local_port: string | null; timestamp: string | null }[];
  host: { id: number; ip: string; nome_dns: string | null; status: string | null }[];
}

export interface RigaDispositivo {
  ip: string;
  mac: string | null;
  /** MAC dell'ARP quando il lease ne ha uno diverso. */
  macArpDiverso: string | null;
  produttore: string | null;
  nome: string | null;
  fonteNome: FonteNome | null;
  interfaccia: string | null;
  lease: "dinamico" | "statico" | null;
  commentoDhcp: string | null;
  lldp: boolean;
  hostId: number | null;
  visto: string | null;
}

export type FiltroDispositivi = "tutti" | "dhcp" | "statici" | "lldp" | "discordanti";

export const PER_PAGINA = 14;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Chiave numerica dell'IPv4, null se non è ben formato (ottetti 0-255). */
function chiaveIp(ip: string | null | undefined): number | null {
  const m = IPV4.exec((ip ?? "").trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

/** `AA:BB:CC:DD:EE:FF`, o null se non ci sono esattamente 12 cifre esadecimali. */
function normalizzaMac(mac: string | null | undefined): string | null {
  const hex = (mac ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return hex.length === 12 ? hex.match(/../g)!.join(":") : null;
}

/** Amministrato localmente: bit 0x02 del primo ottetto, cioè seconda cifra 2, 6, A o E. */
const eMacPrivato = (mac: string): boolean => "26AE".includes(mac[1]);

const testo = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

const ms = (s: string | null): number => {
  if (!s) return NaN;
  return parseDbDate(s).getTime();
};

/** Il più recente fra i timestamp (formati SQLite e ISO mescolati), nel testo originale. */
function piuRecente(date: (string | null)[]): string | null {
  let migliore: string | null = null;
  let mMigliore = -Infinity;
  for (const d of date) {
    const t = ms(d);
    if (Number.isFinite(t) && t > mMigliore) { mMigliore = t; migliore = d; }
  }
  return migliore;
}

export function unisciDispositivi(i: IngressoDispositivi, produttore: (mac: string) => string | null): RigaDispositivo[] {
  type Voce = {
    arp?: IngressoDispositivi["arp"][number];
    arpFallita?: boolean;
    lease?: IngressoDispositivi["lease"][number];
    vicino?: IngressoDispositivi["vicini"][number];
    host?: IngressoDispositivi["host"][number];
  };
  const perIp = new Map<string, Voce>();
  const voce = (ip: string | null | undefined): Voce | null => {
    if (chiaveIp(ip) === null) return null;
    const k = (ip as string).trim();
    let v = perIp.get(k);
    if (!v) { v = {}; perIp.set(k, v); }
    return v;
  };

  for (const a of i.arp) {
    const v = voce(a.ip);
    if (!v) continue;
    const fallita = (a.status ?? "").trim().toLowerCase() === "failed";
    // Fra più righe dello stesso IP vale una non fallita, e fra due uguali la più recente.
    const corrente = v.arp;
    const correnteFallita = v.arpFallita === true;
    if (!corrente || (correnteFallita && !fallita) || (correnteFallita === fallita && ms(a.timestamp) > ms(corrente.timestamp))) {
      v.arp = a;
      v.arpFallita = fallita;
    }
  }
  for (const l of i.lease) { const v = voce(l.ip_address); if (v && !v.lease) v.lease = l; }
  for (const n of i.vicini) { const v = voce(n.remote_ip); if (v && !v.vicino) v.vicino = n; }
  for (const h of i.host) { const v = voce(h.ip); if (v && !v.host) v.host = h; }

  const righe: RigaDispositivo[] = [];
  for (const [ip, v] of perIp) {
    const conferma = !!v.lease || !!v.vicino || (v.host?.status ?? "").toLowerCase() === "online";
    const arp = v.arp && v.arpFallita && !conferma ? undefined : v.arp;
    if (!arp && !v.lease && !v.vicino) continue; // un host IPAM da solo non è «visto dal router»

    const macLease = normalizzaMac(v.lease?.mac_address);
    const macArp = normalizzaMac(arp?.mac);
    const macVicino = normalizzaMac(v.vicino?.remote_mac);
    const mac = macLease ?? macArp ?? macVicino;

    const nomeDhcp = testo(v.lease?.hostname);
    const nomeLldp = testo(v.vicino?.remote_device_name);
    const nomeDns = testo(v.host?.nome_dns);
    const [nome, fonteNome]: [string | null, FonteNome | null] =
      nomeDhcp ? [nomeDhcp, "dhcp"] : nomeLldp ? [nomeLldp, "lldp"] : nomeDns ? [nomeDns, "dns"] : [null, null];

    righe.push({
      ip,
      mac,
      macArpDiverso: macLease && macArp && macLease !== macArp ? macArp : null,
      produttore: mac ? (eMacPrivato(mac) ? "MAC privato" : produttore(mac)) : null,
      nome,
      fonteNome,
      interfaccia: testo(arp?.interface_name) ?? testo(v.vicino?.local_port),
      // dynamic_lease nullo = non dichiarato statico: si tratta come dinamico.
      lease: v.lease ? (v.lease.dynamic_lease === 0 ? "statico" : "dinamico") : null,
      commentoDhcp: testo(v.lease?.description),
      lldp: !!v.vicino,
      hostId: v.host?.id ?? null,
      visto: piuRecente([arp?.timestamp ?? null, v.lease?.last_seen ?? null, v.vicino?.timestamp ?? null]),
    });
  }
  return righe.sort((a, b) => (chiaveIp(a.ip) as number) - (chiaveIp(b.ip) as number));
}

const passa: Record<FiltroDispositivi, (r: RigaDispositivo) => boolean> = {
  tutti: () => true,
  dhcp: (r) => r.lease !== null,
  statici: (r) => r.lease === "statico",
  lldp: (r) => r.lldp,
  discordanti: (r) => r.macArpDiverso !== null,
};

/** Filtro del chip e ricerca libera su IP, MAC, nome, produttore e commento DHCP (senza badare alle maiuscole). */
export function filtraDispositivi(r: RigaDispositivo[], f: FiltroDispositivi, q: string): RigaDispositivo[] {
  const cerca = q.trim().toLowerCase();
  return r.filter((x) => {
    if (!passa[f](x)) return false;
    if (!cerca) return true;
    return [x.ip, x.mac, x.nome, x.produttore, x.commentoDhcp].some((c) => (c ?? "").toLowerCase().includes(cerca));
  });
}

export function contaDispositivi(r: RigaDispositivo[]): Record<FiltroDispositivi, number> {
  const c = {} as Record<FiltroDispositivi, number>;
  for (const f of Object.keys(passa) as FiltroDispositivi[]) c[f] = r.filter(passa[f]).length;
  return c;
}

export interface PaginaDispositivi {
  righe: RigaDispositivo[];
  /** Righe dopo filtro e ricerca. */
  totale: number;
  /** Conteggi dei chip: sempre su tutte le righe. */
  conteggi: Record<FiltroDispositivi, number>;
  pagina: number;
  pagine: number;
}

/** Filtro e pagina lato server: una pagina fuori misura si riporta nei limiti. */
export function paginaDispositivi(tutte: RigaDispositivo[], o: { pagina: number; filtro: FiltroDispositivi; q: string }): PaginaDispositivi {
  const filtrate = filtraDispositivi(tutte, o.filtro, o.q);
  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA));
  const pagina = Math.min(Math.max(1, Math.trunc(o.pagina) || 1), pagine);
  return {
    righe: filtrate.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA),
    totale: filtrate.length,
    conteggi: contaDispositivi(tutte),
    pagina,
    pagine,
  };
}

export const FILTRI_DISPOSITIVI: readonly FiltroDispositivi[] = ["tutti", "dhcp", "statici", "lldp", "discordanti"];
