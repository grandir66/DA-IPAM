/**
 * La chiave di una porta (spec topologia §13.6.1): la stessa porta, comunque la chiami chi la legge, ha una chiave sola —
 * «i:<indice>» se sta nell'elenco delle porte dell'apparato, «n:<nome normalizzato>» per un apparato senza elenco,
 * nessuna chiave se non si sa quale porta sia. I nomi arrivano già tradotti (lettori/): qui nessun nome e nessuna forma
 * di un prodotto (prova I37). Logica pura.
 */
import type { PortaLetta } from "@/lib/topology/lettori/traduci";

export interface Porta {
  nodo: string;
  chiave: string | null;
  nome: string;
  /** false = porta non nota: il nome non dice quale porta dell'apparato sia (su una porta non nota non si contano gli apparati). */
  certa: boolean;
  fisica: boolean | null;
  senzaFili: boolean | null;
  nelBridge: boolean | null;
}

export interface ElencoPorte {
  perNome: ReadonlyMap<string, number[]>;
  perNomeNormale: ReadonlyMap<string, number[]>;
  perIndice: ReadonlyMap<number, string>;
}

type RigaPorta = { port_index: number; port_name: string };

/** La normalizzazione neutra: minuscole, senza spazi. Mai togliendo «_» o «+»: sono porte diverse. */
export function normale(nome: string): string {
  return nome.replace(/\s+/g, "").toLowerCase();
}

function metti(m: Map<string, number[]>, k: string, i: number): void {
  const v = m.get(k);
  if (v) v.push(i);
  else m.set(k, [i]);
}

export function elencoDa(righe: ReadonlyArray<RigaPorta>): ElencoPorte {
  const perNome = new Map<string, number[]>(), perNomeNormale = new Map<string, number[]>(), perIndice = new Map<number, string>();
  for (const r of righe) {
    perIndice.set(r.port_index, r.port_name);
    metti(perNome, r.port_name.trim(), r.port_index);
    metti(perNomeNormale, normale(r.port_name), r.port_index);
  }
  return { perNome, perNomeNormale, perIndice };
}

/** Gli elenchi delle porte di ogni apparato («dev:N» → elenco), dalle righe di switch_ports. */
export function elenchiPorte(righe: ReadonlyArray<RigaPorta & { device_id: number }>): Map<string, ElencoPorte> {
  const perApparato = new Map<string, RigaPorta[]>();
  for (const r of righe) {
    const k = `dev:${r.device_id}`;
    const v = perApparato.get(k);
    if (v) v.push(r);
    else perApparato.set(k, [r]);
  }
  return new Map([...perApparato].map(([k, v]) => [k, elencoDa(v)]));
}

/** L'identificativo LLDP «assegnato localmente»: «Port N» o solo «N». */
const PORTA_N = /^(?:port\s*)?(\d+)$/i;

/**
 * La chiave della porta. Vince il primo passo che dà un risultato unico: 1. l'indice dato dal lettore; 2. il nome
 * esatto fra le porte dell'apparato; 3. il nome uguale dopo la normalizzazione neutra; 4. solo per la porta remota,
 * «Port N» o «N» quando l'apparato ha la porta d'indice N e nessuna porta con quel nome; 5. un apparato senza elenco:
 * il nome normalizzato, per la porta remota solo se è l'unico nome visto verso di lui (`nomiVisti`, prova I46);
 * 6. altrimenti porta non nota (un nome che l'apparato non ha; un nome che corrisponde a più porte).
 */
export function chiavePorta(nodo: string, letta: PortaLetta, lato: "locale" | "remoto", elenco: ElencoPorte | undefined,
  indice?: number | null, nomiVisti?: ReadonlySet<string>): Porta {
  const base = { nodo, nome: letta.nome, fisica: letta.fisica, senzaFili: letta.senzaFili, nelBridge: letta.nelBridge };
  const conIndice = (i: number): Porta => ({ ...base, chiave: `i:${i}`, certa: true });
  const nonNota: Porta = { ...base, chiave: null, certa: false };
  if (indice !== undefined && indice !== null) return conIndice(indice);
  const nome = letta.nome.trim();
  if (nome === "") return nonNota;
  if (elenco) {
    const esatti = elenco.perNome.get(nome) ?? [];
    if (esatti.length === 1) return conIndice(esatti[0]);
    if (esatti.length > 1) return nonNota;
    const normali = elenco.perNomeNormale.get(normale(nome)) ?? [];
    if (normali.length === 1) return conIndice(normali[0]);
    if (normali.length > 1) return nonNota;
    const n = lato === "remoto" ? PORTA_N.exec(nome) : null;
    if (n && elenco.perIndice.has(Number(n[1]))) return conIndice(Number(n[1]));
    return nonNota;
  }
  if (lato === "remoto" && nomiVisti !== undefined && nomiVisti.size > 1) return nonNota;
  return { ...base, chiave: `n:${normale(nome)}`, certa: true };
}

export function stessaPorta(x: Pick<Porta, "chiave">, y: Pick<Porta, "chiave">): boolean {
  return x.chiave !== null && x.chiave === y.chiave;
}

/**
 * Tutti gli indici che portano quel nome nell'elenco, coi passi 2-4 di `chiavePorta` ma senza scegliere: uno se la porta si
 * sa; più di uno per un nome doppio, che non dice la porta (I14) ma può dire la velocità (spec §13.6.1, «Un nome doppio con
 * una velocità sola», I70); nessuno se l'apparato non ha quel nome.
 */
export function indiciInElenco(elenco: ElencoPorte, nome: string): number[] {
  const n = nome.trim();
  if (n === "") return [];
  const esatti = elenco.perNome.get(n) ?? [];
  if (esatti.length > 0) return [...esatti];
  const normali = elenco.perNomeNormale.get(normale(n)) ?? [];
  if (normali.length > 0) return [...normali];
  const p = PORTA_N.exec(n);
  return p && elenco.perIndice.has(Number(p[1])) ? [Number(p[1])] : [];
}

/** L'indice della porta che ha quel nome nell'elenco (passi 2-4), o null: serve alla velocità per chiave. */
export function portaInElenco(elenco: ElencoPorte, nome: string): number | null {
  const p = chiavePorta("", { nome, fisica: null, senzaFili: null, nelBridge: null, fascio: null }, "remoto", elenco);
  return p.chiave === null ? null : Number(p.chiave.slice(2));
}
