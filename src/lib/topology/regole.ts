/**
 * Le regole del passaggio universale entrate in T1 (spec topologia §13.16; criterio C19). Ognuna si può spegnere per la
 * misura (`scripts/misura-cavi.ts --senza-regola <nome>`), che conta padri e teste con tutte le regole e con tutte meno una:
 * così sa che cosa cambia ognuna. Spenta, una regola dà il comportamento che la tappa aveva prima del passaggio universale.
 * Una regola che cambia un padre senza un perché resta fuori da T1 (C19): si toglie da `REGOLE_T1`, codice e prove restano.
 * Logica pura.
 */
export const NOMI_REGOLE = [
  "nome-scelto-non-fisico", // un nome scelto dal cliente non è una porta fisica per un router col traduttore del suo prodotto (§13.6.1, H7)
  "conto-per-apparato", // le righe di RouterOS dello stesso apparato con più MAC sono un apparato solo (§13.6.4, I60)
  "vm-e-mac-propri", // fra una VM e il suo hypervisor nessun collegamento; i MAC propri non sono VM, client né vicini (§13.7.8, H15)
  "testa-per-reti", // a pari nodi raggiunti, la testa proposta è il gateway di più reti, non l'id più basso (§13.8.1, H17)
  "velocita-nomi-doppi", // un nome di più porte tutte alla stessa velocità dà la velocità (§13.6.1, H13, I70)
] as const;

export type RegolaUniversale = (typeof NOMI_REGOLE)[number];
export type Regole = ReadonlySet<RegolaUniversale>;

/** Le regole accese nell'app. */
export const REGOLE_T1: Regole = new Set<RegolaUniversale>(NOMI_REGOLE);

export function leggiRegola(x: string): RegolaUniversale | null {
  return (NOMI_REGOLE as readonly string[]).includes(x) ? (x as RegolaUniversale) : null;
}
