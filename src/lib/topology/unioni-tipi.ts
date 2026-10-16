/** Unioni e separazioni a mano (piano 2026-10-16, ADR 0021): tipi e parole fra DB, indice, rotte e dialoghi. Nessun import. */

/** Perché un host sta nel nodo di un altro oggetto: le regole di node-index.ts, in ordine. */
export type ComeFuso = "host_dell_apparato" | "stesso_ip" | "stesso_apparato_fisico" | "stesso_mac" | "stesso_nome" | "a_mano";
/** Gli indirizzi dell'apparato stesso: non si separano. */
export const NON_SEPARABILI: ReadonlySet<ComeFuso> = new Set<ComeFuso>(["host_dell_apparato", "stesso_ip"]);

export interface ModelUnioneRow { gruppo: number; membro: string }
/** `membro` («host:N») non si fonde da solo con `altro` («dev:N» o «host:N»). */
export interface ModelSeparazioneRow { membro: string; altro: string }
export interface RigaUnione extends ModelUnioneRow { id: number; creato_da: string; creato_il: string }
export interface RigaSeparazione extends ModelSeparazioneRow { id: number; creato_da: string; creato_il: string }
/** Che cosa scrivere in una transazione; le righe «nuovo» hanno lo stesso gruppo nuovo. */
export interface PianoUnioni {
  togliUnioni: number[]; togliSeparazioni: number[];
  aggiungiUnioni: Array<{ gruppo: number | "nuovo"; membro: string }>;
  aggiungiSeparazioni: Array<{ membro: string; altro: string }>;
}
/** Nel modello solo se l'ingresso ha righe. */
export interface InfoUnioni {
  aMano: Record<string, number[]>; // nodo → host entrati a mano
  nonApplicate: Array<{ gruppo: number; membri: string[]; motivo: string }>;
  mancanti: string[];
  separazioni: number;
}

export interface OggettoDaUnire { id: string; nome: string; tipo: "apparato" | "host"; indirizzi: string[]; bloccato: string | null }
export interface CandidatiUnione { candidati: OggettoDaUnire[]; altri: number }
export interface MembroDelNodo {
  id: string; nome: string; ip: string | null;
  come: ComeFuso | "oggetto"; // «oggetto» = l'apparato del nodo o il rappresentante di un nodo di soli host
  separabile: boolean; perche: string | null; aMano: { da: string; il: string } | null;
}
export interface StatoDelNodo {
  oggetto: string; nodo: string; nome: string; membri: MembroDelNodo[];
  nonApplicata: { membri: string[]; motivo: string } | null; mancanti: string[];
  disponibile: boolean; // false = tabelle assenti su questo cliente
}
/** Nomi e IP accanto agli id: tre indirizzi con lo stesso nome non sono tre righe uguali (verifica a schermo, 16/10). */
export interface AnteprimaUnione {
  nodo: string; nome: string; entrano: Array<{ id: string; nome: string; ip: string | null; perche: string }>;
  separazioniTolte: Array<{
    membro: string; altro: string; il: string; nomeMembro: string; ipMembro: string | null; nomeAltro: string; ipAltro: string | null;
  }>;
  scritto: boolean;
}
export interface AnteprimaSeparazione {
  resta: { nodo: string; nome: string; membri: string[] };
  escono: Array<{ nodo: string; nome: string; membri: string[] }>; scritto: boolean;
}
export interface CorpoUnione { membri: string[]; applica: boolean }
export interface CorpoSeparazione { nodo: string; membro: string; applica: boolean }

export const LIMITE_CANDIDATI = 20;
export const MIN_CARATTERI_RICERCA = 2;
export const MAX_MEMBRI_UNIONE = 20;

export const PAROLA_COME: Readonly<Record<ComeFuso, string>> = {
  host_dell_apparato: "indirizzo dell'apparato",
  stesso_ip: "stesso IP con cui si gestisce l'apparato",
  stesso_apparato_fisico: "stesso apparato fisico (dalle sue interfacce)",
  stesso_mac: "stesso MAC",
  stesso_nome: "stesso nome",
  a_mano: "unito a mano",
};
export const TESTI_UNIONI = {
  giaStesso: "Sono già lo stesso oggetto sulla mappa.",
  dueApparati: (a: string, b: string): string =>
    `«${a}» e «${b}» sono due apparati censiti: non si uniscono. Si toglie uno dei due da «Apparati» e poi si unisce il suo indirizzo.`,
  nonTrovato: (id: string): string => `Oggetto non trovato: ${id}.`,
  nonNelNodo: "Questo indirizzo non fa parte di quell'oggetto sulla mappa.",
  eLApparato: "È l'apparato: si separano i suoi indirizzi, non l'apparato.",
  nonSeparabile: (come: "host_dell_apparato" | "stesso_ip"): string =>
    come === "host_dell_apparato" ? "È l'indirizzo dell'apparato: non si separa." : "Ha l'IP con cui si gestisce l'apparato: non si separa.",
  doppio: "Lo stesso oggetto è scelto due volte.",
  /** Un'unione che sposterebbe membri di un'altra, o le ancore che non finirebbero insieme: `nome` è l'altra com'è sulla mappa. */
  cambiaAltra: (nome: string): string =>
    `Questa unione cambierebbe anche «${nome}», un'altra unione già fatta: separa prima i suoi indirizzi uniti a mano, poi riprova.`,
  schemaAssente: "Le unioni non sono disponibili su questo cliente: la migrazione non è riuscita (vedi il journal).",
  cambiato: "Nel frattempo le unioni sono cambiate: riapri il dialogo.",
} as const;
