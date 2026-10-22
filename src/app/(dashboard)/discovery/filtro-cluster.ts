/**
 * Regola unica «quale riga si vede» di Discovery con gli IP accorpati (piano 2026-10-22, Task 5): usata dalla tabella,
 * dalle chip e dai contatori. L'API marca ogni riga (`cluster`); qui il client decide solo cosa nascondere.
 * - riga secondaria di un cluster: nascosta, tranne col filtro «Rete» impostato sulla sua rete (nella vista per rete
 *   ogni IP resta nella sua subnet);
 * - la ricerca guarda anche gli IP secondari: se la principale corrisponde solo per uno di loro, la riga compare
 *   e dice quale;
 * - `cluster` assente/null (host solo o cluster ambiguo): invariato, tutte le righe restano.
 */
import type { InfoClusterDiscovery } from "@/lib/devices/cluster-discovery";

export type VistaRiga = { visibile: false } | { visibile: true; trovataComeSecondario: string | null };

export interface RigaCluster {
  id: number;
  network_id: number;
  cluster?: InfoClusterDiscovery | null;
  /** Testo su cui la ricerca confronta la riga stessa (IP, MAC, nome, rete…). */
  testoRiga: string;
}

export function vistaRiga(
  h: RigaCluster,
  filtro: { testo: string; reteId: string | null },
  corrisponde: (testo: string) => boolean,
): VistaRiga {
  const c = h.cluster ?? null;
  if (filtro.reteId && String(h.network_id) !== filtro.reteId) return { visibile: false };
  if (c && !c.principale && !filtro.reteId) return { visibile: false };
  if (!filtro.testo) return { visibile: true, trovataComeSecondario: null };
  if (corrisponde(h.testoRiga)) return { visibile: true, trovataComeSecondario: null };
  if (c?.principale) {
    const trovato = c.altri.find((a) => corrisponde(a.ip));
    if (trovato) return { visibile: true, trovataComeSecondario: trovato.ip };
  }
  return { visibile: false };
}

export interface ContatoriDiscovery {
  /** Righe mostrate dopo i filtri: un cluster conta 1. */
  mostrate: number;
  /** Righe dopo l'accorpamento, senza filtri («di M»). */
  totale: number;
  /** IP secondari nascosti dentro le righe mostrate («K IP accorpati»). */
  accorpati: number;
  /** Stato della riga principale: il secondario offline si vede nell'elenco «+N IP». */
  online: number;
  offline: number;
  sconosciuti: number;
}

type RigaConteggio = { id: number; status: string; cluster?: InfoClusterDiscovery | null };

export function contatoriDiscovery(tutte: readonly RigaConteggio[], mostrate: readonly RigaConteggio[]): ContatoriDiscovery {
  const idMostrate = new Set(mostrate.map((h) => h.id));
  let accorpati = 0;
  for (const h of mostrate) {
    // Un secondario già mostrato come riga propria (filtro rete) non è «nascosto».
    if (h.cluster?.principale) accorpati += h.cluster.altri.filter((a) => !idMostrate.has(a.host_id)).length;
  }
  const online = mostrate.filter((h) => h.status === "online").length;
  const offline = mostrate.filter((h) => h.status === "offline").length;
  return {
    mostrate: mostrate.length,
    totale: tutte.filter((h) => !(h.cluster && !h.cluster.principale)).length,
    accorpati,
    online,
    offline,
    sconosciuti: mostrate.length - online - offline,
  };
}
