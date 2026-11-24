/**
 * Tipi della «Tavola di cablaggio» (spec 2026-11-23-tavola-di-cablaggio-design): la seconda vista della Topologia, dove
 * ogni apparato è un pannello di porte con sotto la destinazione. Logica pura: nessun import del DB. Le porte arrivano
 * dalla rotta GET /api/topology/tavola, i collegamenti dal modello della mappa (non si ricalcola niente).
 */
import type { MapLink, MapNode } from "@/lib/topology/model-types";

/** Una porta come la legge il server: una riga di `switch_ports`, o una scheda dell'hypervisor (senza indice). */
export interface PortaTavola {
  indice: number | null;
  nome: string;
  stato: "up" | "down" | "disabled" | null;
  velocita: string | null;
  vlan: number | null;
  trunk: boolean;
  macCount: number;
  nomeClient: string | null;
  ipClient: string | null;
  poeW: number | null;
}

export interface ApparatoPorte { node: string; porte: PortaTavola[] }

/** La risposta della rotta: i siti, i nodi e i collegamenti che toccano il sito, le porte dei suoi apparati. */
export interface TavolaView {
  site: number;
  siti: Array<{ id: number; name: string }>;
  /** Gli armadi (e i locali) degli apparati del sito, col percorso dentro la sede: «CED › Armadio 1». */
  armadi: Array<{ id: number; name: string }>;
  nodi: MapNode[];
  collegamenti: MapLink[];
  apparati: ApparatoPorte[];
  staleDays: number;
}

/**
 * Il tipo di una porta (spec §3). Il colore non basta (Riccardo è daltonico): ogni tipo ha anche la sua forma.
 * `attiva` è una porta su senza collegamento e senza MAC letti: si sa solo che è accesa.
 */
export type TipoPorta = "linea" | "trunk" | "server" | "client" | "molti" | "attiva" | "libera";

export interface PortaComposta {
  /** `<nodo>|<n>`: unico nella tavola. */
  id: string;
  nodo: string;
  /** Il numero corto scritto dentro il quadrato. */
  numero: string;
  /** Il nome della porta com'è letto. */
  nome: string;
  tipo: TipoPorta;
  /** Dove va, scritto sotto la porta; null = niente da scrivere. */
  destinazione: string | null;
  /** Collegamento non visto di recente, porte da verificare, o porta giù con un collegamento: «da verificare». */
  dubbio: boolean;
  /** L'id del collegamento del modello (MapLink.id), se la porta ne ha uno. */
  collegamento: string | null;
  altroNodo: string | null;
  /** La porta non è nell'elenco dell'apparato: nasce dal nome letto nel collegamento (spec §7). */
  fantasma: boolean;
  /** I membri di un fascio portano l'id del collegamento: la graffa li unisce. */
  fascio: string | null;
  velocita: string | null;
  vlan: number | null;
  /** La riga letta dall'apparato; null per una porta fantasma. */
  letta?: PortaTavola | null;
}

export interface ApparatoComposto {
  nodo: string;
  refId: number;
  nome: string;
  tipo: string;
  ip: string | null;
  rackId: number | null;
  /** Il nome dell'armadio col suo percorso dentro la sede. */
  armadio?: string | null;
  /** Per l'ordine in fila: 0 router/firewall, 1 core, 2 accesso, 3 hypervisor, 4 il resto. */
  rango: number;
  porte: PortaComposta[];
}

/** Un cavo da disegnare: tutti e due i capi sono porte della tavola. */
export interface CavoComposto {
  /** `<collegamento>` o `<collegamento>#<membro>` per i membri di un fascio. */
  id: string;
  collegamento: string;
  da: string;
  a: string;
  tipo: TipoPorta;
  dubbio: boolean;
}

export interface TavolaComposta {
  apparati: ApparatoComposto[];
  cavi: CavoComposto[];
}
