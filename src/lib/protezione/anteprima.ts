/**
 * L'anteprima di una politica degli accessi, in parole (Protezione, tappa 2; piano §4.3): cosa cambia rispetto
 * a quella in vigore, e chi resterebbe fuori fra gli indirizzi che si sono visti arrivare. Modulo puro.
 */
import net from "node:net";
import { GRUPPI, NOME_GRUPPO, PORTE_GRUPPO, type GruppoAccessi, type Politica } from "./politica";
import { inRete } from "./sistemi";

export const RETE_NETBIRD = "100.64.0.0/10";

/** Un indirizzo visto arrivare a una porta (dai set `fuori4`/`fuori6` della tabella). */
export interface Visto {
  indirizzo: string;
  porta: number;
}

/** Il gruppo di una porta; `null` = fuori da ogni gruppo (a filtro acceso non risponde). */
export function gruppoDellaPorta(porta: number): GruppoAccessi | null {
  return GRUPPI.find((g) => PORTE_GRUPPO[g].tcp.includes(porta) || PORTE_GRUPPO[g].udp.includes(porta)) ?? null;
}

/** L'indirizzo sta in una voce dell'elenco? IPv4 per rete; IPv6 solo l'indirizzo scritto uguale (le reti IPv6 le decide nft). */
export function inElenco(indirizzo: string, elenco: readonly string[]): boolean {
  return elenco.some((v) => {
    if (v === indirizzo) return true;
    if (net.isIPv4(indirizzo) && !v.includes(":")) return inRete(indirizzo, v.includes("/") ? v : `${v}/32`);
    return false;
  });
}

/** Con questa politica, chi arriva da `indirizzo` alla `porta` passa? NetBird e i sempre ammessi passano sempre. */
export function passa(p: Politica, indirizzo: string, porta: number): boolean {
  if (inRete(indirizzo, RETE_NETBIRD) || inElenco(indirizzo, p.sempre)) return true;
  const g = gruppoDellaPorta(porta);
  if (!g) return false;
  return p.gruppi[g].aperto || inElenco(indirizzo, p.gruppi[g].indirizzi);
}

export interface Anteprima {
  /** Le differenze, una frase per riga; vuoto = niente cambia. */
  cambi: string[];
  /** Fra gli indirizzi visti arrivare, chi con questa politica non passerebbe. */
  fuori: Array<Visto & { gruppo: string }>;
  /** Avvisi che chi applica deve leggere prima (chi sta applicando resterebbe fuori, un gruppo aperto a tutti…). */
  avvisi: string[];
}

export function anteprimaPolitica(prima: Politica, dopo: Politica, visti: readonly Visto[], chiamante: string | null): Anteprima {
  const cambi: string[] = [];
  const differenze = (nome: string, a: readonly string[], b: readonly string[]) => {
    for (const x of b) if (!a.includes(x)) cambi.push(`${nome}: entra ${x}`);
    for (const x of a) if (!b.includes(x)) cambi.push(`${nome}: esce ${x}`);
  };
  differenze("Sempre ammessi", prima.sempre, dopo.sempre);
  const avvisi: string[] = [];
  for (const g of GRUPPI) {
    differenze(NOME_GRUPPO[g], prima.gruppi[g].indirizzi, dopo.gruppi[g].indirizzi);
    if (prima.gruppi[g].aperto !== dopo.gruppi[g].aperto) cambi.push(`${NOME_GRUPPO[g]}: ${dopo.gruppi[g].aperto ? "diventa aperto a tutti" : "non è più aperto a tutti"}`);
    if (dopo.gruppi[g].aperto) avvisi.push(`${NOME_GRUPPO[g]} resta aperto a chiunque arrivi alla macchina.`);
  }
  if (chiamante && !passa(dopo, chiamante, 443)) {
    avvisi.unshift(`Il tuo indirizzo (${chiamante}) non aprirà più la pagina web: a filtro acceso non potrai confermare, e dopo la prova torneranno le regole di prima.`);
  }
  const fuori = visti
    .filter((v) => !passa(dopo, v.indirizzo, v.porta))
    .map((v) => ({ ...v, gruppo: (() => { const g = gruppoDellaPorta(v.porta); return g ? NOME_GRUPPO[g] : "Porta fuori dai gruppi"; })() }))
    .sort((a, b) => a.indirizzo.localeCompare(b.indirizzo, undefined, { numeric: true }) || a.porta - b.porta);
  return { cambi, fuori, avvisi };
}

/** Gli elementi di un set `fuori4`/`fuori6` dall'uscita di `nft -j list set`: coppie indirizzo . porta. */
export function leggiFuori(json: string): Visto[] {
  let dati: unknown;
  try {
    dati = JSON.parse(json);
  } catch {
    return [];
  }
  const righe = (dati as { nftables?: unknown[] })?.nftables;
  if (!Array.isArray(righe)) return [];
  const visti: Visto[] = [];
  for (const r of righe) {
    const elem = (r as { set?: { elem?: unknown[] } })?.set?.elem;
    if (!Array.isArray(elem)) continue;
    for (const e of elem) {
      // Con il timeout ogni elemento è `{ elem: { val: { concat: [ip, porta] }, … } }`; senza, `{ concat: [...] }`.
      const val = (e as { elem?: { val?: unknown } })?.elem?.val ?? e;
      const coppia = (val as { concat?: unknown[] })?.concat;
      if (Array.isArray(coppia) && typeof coppia[0] === "string" && typeof coppia[1] === "number") visti.push({ indirizzo: coppia[0], porta: coppia[1] });
    }
  }
  return visti;
}
