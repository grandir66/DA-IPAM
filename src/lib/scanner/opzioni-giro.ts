/**
 * Campi per-giro del lanciatore: parse e range. Niente IP nei messaggi di errore.
 */
import { getAllHostIps, isIpInCidr, parseCidr } from "@/lib/utils";
import { PORTE_STAMPA_RAW } from "./ports";
import {
  PRESET_PORTE_GIRO,
  PROTOCOLLI_SEG,
  SCAN_MODE_GIRO,
  SRC_PORT_GIRO,
  type PresetPorteGiro,
  type ProtocolloSeg,
  type ScanModeGiro,
} from "./profili-giro-ui";

export class ErroreLancio extends Error {
  readonly status: number;
  constructor(messaggio: string, status = 400) {
    super(messaggio);
    this.status = status;
  }
}

export const RATE_PPS_MIN = 10;
export const RATE_PPS_MAX = 10_000;
export const RETRIES_MIN = 0;
export const RETRIES_MAX = 5;
export const DURATA_S_MIN = 1;
export const DURATA_S_MAX = 600;
export const TETTO_PORTE_ELENCO = 4096;
const PREFISSO_MINIMO = 16;

export function interoNelRange(v: unknown, nome: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ErroreLancio(`${nome} deve essere un intero tra ${min} e ${max}`);
  }
  return v;
}

export function booleanoOpzionale(v: unknown, nome: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new ErroreLancio(`${nome} deve essere vero o falso`);
  return v;
}

function eIpv4(s: string): boolean {
  const p = s.split(".");
  if (p.length !== 4) return false;
  return p.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255);
}

/** Token IPv4 o CIDR IPv4 (prefisso ≥ /16). Non espande. */
export function parseBersagliTesto(testo: unknown, nome: string): string[] {
  if (testo === undefined || testo === null || testo === "") return [];
  if (typeof testo !== "string") throw new ErroreLancio(`${nome} deve essere una stringa`);
  const token = testo.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of token) {
    const [ip, prefissoGrezzo] = t.split("/");
    if (!ip || !eIpv4(ip)) throw new ErroreLancio(`${nome}: solo indirizzi o reti IPv4`);
    if (prefissoGrezzo === undefined) {
      out.push(ip);
      continue;
    }
    const prefisso = Number(prefissoGrezzo);
    if (!Number.isInteger(prefisso) || prefisso < PREFISSO_MINIMO || prefisso > 32) {
      throw new ErroreLancio(`${nome}: il prefisso deve essere tra /${PREFISSO_MINIMO} e /32`);
    }
    out.push(`${ip}/${prefisso}`);
  }
  return out;
}

function espandiToken(token: string): string[] {
  if (!token.includes("/")) return [token];
  try {
    return getAllHostIps(token);
  } catch {
    throw new ErroreLancio("Rete non valida");
  }
}

export function tokenCopreRete(token: string, cidr: string): boolean {
  if (!token.includes("/")) return isIpInCidr(token, cidr);
  try {
    const t = parseCidr(token);
    const r = parseCidr(cidr);
    return t.networkLong <= r.broadcastLong && r.networkLong <= t.broadcastLong;
  } catch {
    return false;
  }
}

/** IP di una rete: auto (prefisso) ∪ bersagli che cadono nella rete, meno esclusioni. */
export function ipPerRete(opts: {
  cidr: string;
  auto: boolean;
  bersagli: string[];
  esclusioni: string[];
}): string[] {
  const set = new Set<string>();
  if (opts.auto) for (const ip of getAllHostIps(opts.cidr)) set.add(ip);
  for (const t of opts.bersagli) {
    for (const ip of espandiToken(t)) {
      if (isIpInCidr(ip, opts.cidr)) set.add(ip);
    }
  }
  for (const t of opts.esclusioni) {
    for (const ip of espandiToken(t)) set.delete(ip);
  }
  return [...set];
}

export function eScanModeGiro(v: string): v is ScanModeGiro {
  return (SCAN_MODE_GIRO as readonly string[]).includes(v);
}

export function eProtocolloSeg(v: string): v is ProtocolloSeg {
  return (PROTOCOLLI_SEG as readonly string[]).includes(v);
}

export function leggiScanMode(v: unknown): ScanModeGiro | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !eScanModeGiro(v)) {
    throw new ErroreLancio("scan_mode deve essere auto, syn o connect");
  }
  return v;
}

export function leggiProtocolloSeg(v: unknown): ProtocolloSeg {
  if (v === undefined || v === null || v === "") return "direct";
  if (typeof v !== "string" || !eProtocolloSeg(v)) {
    throw new ErroreLancio("protocollo deve essere direct, icmp_echo, ipv6 o fragmented_syn");
  }
  return v;
}

export interface PorteGiroLette {
  preset?: PresetPorteGiro;
  elenco: string | null;
  tutte: boolean;
  vuoto: boolean;
}

export function leggiPorteGiro(v: unknown, nome: string, confermaTutte: boolean): PorteGiroLette | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ErroreLancio(`${nome} deve essere una stringa`);
  const testo = v.trim();
  if (testo === "") return { elenco: "", tutte: false, vuoto: true };
  if ((PRESET_PORTE_GIRO as readonly string[]).includes(testo)) {
    const preset = testo as PresetPorteGiro;
    if (preset === "all" && !confermaTutte) {
      throw new ErroreLancio("Tutte le porte non partono da sole: conferma che vuoi tutte le 65.535 porte TCP");
    }
    return { preset, elenco: preset === "all" ? null : preset, tutte: preset === "all", vuoto: false };
  }
  const porte: number[] = [];
  for (const pezzo of testo.split(",")) {
    const t = pezzo.trim();
    if (!t) continue;
    const m = t.match(/^(\d{1,5})-(\d{1,5})$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 1 || b > 65535 || a > b) throw new ErroreLancio(`${nome}: intervallo porte non valido`);
      if (b - a + 1 > TETTO_PORTE_ELENCO) throw new ErroreLancio(`${nome}: al massimo ${TETTO_PORTE_ELENCO} porte`);
      for (let p = a; p <= b; p++) porte.push(p);
      continue;
    }
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ErroreLancio(`${nome}: porta non valida`);
    porte.push(n);
  }
  const noStampa = new Set<number>(PORTE_STAMPA_RAW);
  const uniche = [...new Set(porte)].filter((p) => !noStampa.has(p));
  if (uniche.length === 0) throw new ErroreLancio(`${nome}: nessuna porta sondabile (le porte di stampa non si toccano)`);
  if (uniche.length > TETTO_PORTE_ELENCO) throw new ErroreLancio(`${nome}: al massimo ${TETTO_PORTE_ELENCO} porte`);
  return { elenco: uniche.join(","), tutte: false, vuoto: false };
}

export function leggiSrcPort(v: unknown): number[] {
  if (v === undefined || v === null) return [];
  const lista = Array.isArray(v) ? v : [v];
  const consenti = new Set<number>(SRC_PORT_GIRO);
  const out: number[] = [];
  for (const n of lista) {
    if (typeof n !== "number" || !Number.isInteger(n) || !consenti.has(n)) {
      throw new ErroreLancio(`src_port ammesse: ${SRC_PORT_GIRO.join(", ")}`);
    }
    out.push(n);
  }
  return [...new Set(out)];
}

export function leggiIdReti(v: unknown, nome: string): number[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ErroreLancio(`${nome} deve essere un elenco di reti`);
  const out: number[] = [];
  for (const n of v) {
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      throw new ErroreLancio(`${nome}: ogni voce deve essere un id rete valido`);
    }
    out.push(n);
  }
  return [...new Set(out)];
}

const TECNICHE_AUDITOR = "Questa tecnica da auditor non è ancora disponibile sulla sonda";

export function rifiutaTecnicheAuditor(opts: {
  protocollo: ProtocolloSeg;
  srcPort: number[];
  viaLocalGateway?: boolean;
  viaOtherNextHop?: boolean;
  l2Active?: boolean;
  confermaL2?: boolean;
}): void {
  if (opts.l2Active && opts.confermaL2 !== true) {
    throw new ErroreLancio("L2 attivo può disturbare lo switch: serve una conferma esplicita");
  }
  if (opts.protocollo !== "direct" || opts.srcPort.length > 0 || opts.viaLocalGateway || opts.viaOtherNextHop || opts.l2Active) {
    throw new ErroreLancio(TECNICHE_AUDITOR);
  }
}
