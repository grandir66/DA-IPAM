/**
 * Regola unica «quale riga si vede» di Discovery con gli IP accorpati (piano 2026-10-22, Task 5): usata dalla tabella,
 * dalle chip e dai contatori. L'API marca ogni riga (`cluster`); qui il client decide solo cosa nascondere.
 * - riga secondaria di un cluster: nascosta, tranne col filtro «Rete» impostato sulla sua rete (nella vista per rete
 *   ogni IP resta nella sua subnet);
 * - ogni filtro (ricerca compresa, su IP, nome e MAC dei secondari) guarda anche i membri: se la principale
 *   corrisponde solo grazie a uno di loro, la riga compare e dice quale;
 * - `cluster` assente/null (host solo o cluster ambiguo): invariato, tutte le righe restano.
 */
import type { InfoClusterDiscovery } from "@/lib/devices/cluster-discovery";

/** `corrispondeSecondario`: IP dei membri che hanno fatto corrispondere la riga al posto della principale. */
export type VistaRiga = { visibile: false } | { visibile: true; corrispondeSecondario: string[] };

export interface RigaCluster {
  id: number;
  network_id: number;
  cluster?: InfoClusterDiscovery | null;
}

/** Un filtro attivo (stato, classificazione, CVE, ricerca) valutato su un host qualsiasi, per id. */
export type Criterio = (hostId: number) => boolean;

/**
 * Regola unica per tabella, CSV e contatori (revisione finale 22/10). Prima stato/classificazione/CVE si applicavano
 * riga per riga PRIMA di nascondere i secondari: un problema solo su un IP secondario spariva dalla lista.
 * - riga principale di un cluster: ogni criterio è soddisfatto se lo soddisfa la principale O uno dei membri
 *   (anche membri diversi per criteri diversi); la riga dice quali membri hanno fatto corrispondere;
 * - col filtro «Rete» ogni IP è una riga a sé nella sua rete e i criteri si valutano solo su di lui;
 * - host solo o cluster ambiguo (`cluster` null): decide solo la riga.
 */
export function vistaRigaConCriteri(h: RigaCluster, reteId: string | null, criteri: readonly Criterio[]): VistaRiga {
  const c = h.cluster ?? null;
  if (reteId && String(h.network_id) !== reteId) return { visibile: false };
  if (c && !c.principale && !reteId) return { visibile: false };
  const membri = c?.principale && !reteId ? c.altri : [];
  const usati: string[] = [];
  for (const ok of criteri) {
    if (ok(h.id)) continue;
    const m = membri.find((a) => ok(a.host_id));
    if (!m) return { visibile: false };
    if (!usati.includes(m.ip)) usati.push(m.ip);
  }
  return { visibile: true, corrispondeSecondario: usati };
}

/** Colonna CSV «Altri IP»: gli IP accorpati nella riga principale, «ip · rete; ip · rete». Vuota altrove. */
export function altriIpCsv(c: InfoClusterDiscovery | null | undefined): string {
  if (!c?.principale) return "";
  return c.altri.map((a) => `${a.ip} · ${a.network_name}`).join("; ");
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
