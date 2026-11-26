/**
 * I sistemi remoti con una connessione aperta in questo momento, da `ss -H -tn state established`
 * (Protezione, tappa 1). Modulo puro. È una fotografia: chi parla ogni tanto può non esserci.
 */
import { separaIndirizzo, soloMacchina } from "./ascolto";

export interface SistemaRemoto {
  indirizzo: string;
  /** `entra` = ha chiamato una nostra porta in ascolto; `esce` = lo abbiamo chiamato noi. */
  verso: "entra" | "esce";
  /** La porta nostra (entra) o la sua (esce). */
  porta: number;
  connessioni: number;
}

export function leggiConnessioni(testo: string, porteInAscolto: ReadonlySet<number>, interno: (indirizzo: string) => boolean): SistemaRemoto[] {
  const mappa = new Map<string, SistemaRemoto>();
  for (const riga of testo.split("\n")) {
    const campi = riga.trim().split(/\s+/);
    if (campi.length < 4) continue;
    const nostro = separaIndirizzo(campi[campi.length - 2]);
    const suo = separaIndirizzo(campi[campi.length - 1]);
    if (!nostro || !suo) continue;
    const indirizzo = suo.indirizzo.replace(/^::ffff:/, "");
    if (soloMacchina(indirizzo) || interno(indirizzo)) continue;
    const entra = porteInAscolto.has(nostro.porta);
    const porta = entra ? nostro.porta : suo.porta;
    const chiave = `${indirizzo}|${entra ? "entra" : "esce"}|${porta}`;
    const c = mappa.get(chiave);
    if (c) c.connessioni += 1;
    else mappa.set(chiave, { indirizzo, verso: entra ? "entra" : "esce", porta, connessioni: 1 });
  }
  return [...mappa.values()].sort((a, b) => a.verso.localeCompare(b.verso) || a.indirizzo.localeCompare(b.indirizzo, undefined, { numeric: true }) || a.porta - b.porta);
}

/** Un indirizzo sta in una rete IPv4 `a.b.c.d/n`? Per gli altri formati risponde no. */
export function inRete(indirizzo: string, cidr: string): boolean {
  const [base, bit] = cidr.split("/");
  const n = Number(bit);
  const num = (ip: string): number | null => {
    const p = ip.split(".").map(Number);
    return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null;
  };
  const a = num(indirizzo);
  const b = num(base);
  if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
  const maschera = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return (a & maschera) === (b & maschera);
}
