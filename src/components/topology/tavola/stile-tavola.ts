/**
 * L'aspetto di ogni tipo di porta e di cavo nella tavola (spec tavola §4 punto 2). Riccardo è daltonico: ogni tipo ha un
 * segno che non dipende dal colore — pieno scuro, bordo doppio, pieno chiaro, vuoto, tratteggio — e i cavi cambiano
 * spessore e trattino oltre che tinta. Colori dai token del tema (chiaro e scuro).
 */
import type { TipoPorta } from "@/lib/topology/tavola/tipi";

export interface StilePorta {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  /** Un secondo bordo dentro il quadrato (trunk). */
  doppio?: boolean;
  /** Tratteggio diagonale (molti MAC). */
  righe?: boolean;
  testo: string;
}

export interface StileCavo { stroke: string; width: number; dash?: string }

const CHIARO = "color-mix(in srgb, var(--primary) 35%, var(--card))";

export const STILE_PORTA: Readonly<Record<TipoPorta, StilePorta>> = {
  linea: { fill: "var(--foreground)", stroke: "var(--foreground)", strokeWidth: 1, testo: "var(--card)" },
  trunk: { fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 1.5, doppio: true, testo: "var(--foreground)" },
  server: { fill: CHIARO, stroke: "var(--cian-testo)", strokeWidth: 1, testo: "var(--foreground)" },
  client: { fill: "var(--card)", stroke: "var(--foreground)", strokeWidth: 1.5, testo: "var(--foreground)" },
  molti: { fill: "var(--card)", stroke: "var(--foreground)", strokeWidth: 1.5, righe: true, testo: "var(--foreground)" },
  attiva: { fill: "var(--muted)", stroke: "var(--muted-foreground)", strokeWidth: 1, testo: "var(--foreground)" },
  libera: { fill: "transparent", stroke: "var(--muted-foreground)", strokeWidth: 1.2, dash: "3 3", testo: "var(--muted-foreground)" },
};

export const STILE_CAVO: Readonly<Record<TipoPorta, StileCavo>> = {
  linea: { stroke: "var(--foreground)", width: 2.5 },
  trunk: { stroke: "var(--primary)", width: 3 },
  server: { stroke: "var(--cian-testo)", width: 2, dash: "9 3" },
  client: { stroke: "var(--muted-foreground)", width: 1.5, dash: "3 3" },
  molti: { stroke: "var(--muted-foreground)", width: 1.5, dash: "3 3" },
  attiva: { stroke: "var(--muted-foreground)", width: 1.5, dash: "1 3" },
  libera: { stroke: "var(--muted-foreground)", width: 1, dash: "1 3" },
};

export const NOME_TIPO: Readonly<Record<TipoPorta, string>> = {
  linea: "Linea / fuori sede",
  trunk: "Fra apparati di rete",
  server: "Server / hypervisor",
  client: "Un client",
  molti: "Più MAC",
  attiva: "Senza dati",
  libera: "Libera / giù",
};

export const ORDINE_TIPI: readonly TipoPorta[] = ["linea", "trunk", "server", "client", "molti", "attiva", "libera"];
