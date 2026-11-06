import type Database from "better-sqlite3";
import { getActiveEvidence, recordEvidence } from "./evidence";
import type { AttributionSignals } from "./emitters";
import { recomputeHostAttribution } from "./recompute";
import { categoryDepth, categoryParent, isValidCategory } from "./taxonomy";
import type { CategorySlug } from "./taxonomy";
import type { AttributionDimension, AttributionEvidenceRow, AttributionSource, EvidenceInput } from "./types";
import { ATTR_SOURCE_WEIGHTS } from "./weights";

/**
 * IP contesi (Riccardo, 06/11/2026): gli host su cui le fonti dicono cose diverse.
 * Si mettono a confronto, una persona sceglie la cella e la scelta resta manuale.
 *
 * «Conteso» non e' `count(distinct claim)`: sull'hub darebbe 222 host su 361, gonfiati
 * da `proxmox`/`proxmox-server-solutions` e da `compute` accanto a `compute.server`,
 * che non si contraddicono. E non e' nemmeno il `conflicts` del motore (12 host), che
 * guarda solo i primi due punteggi e tace quando vince una fonte dichiarativa.
 */

export const ORDINE_DIMENSIONI: readonly AttributionDimension[] = ["category", "os", "vendor"];

/** Tetto delle righe in modale: una /17 non deve portare al browser tutto l'archivio. */
export const LIMITE_RIGHE_CONTESI = 1000;

export interface HostContesoRiga {
  id: number;
  ip: string;
  hostname: string | null;
  attr_vendor: string | null;
  attr_category: string | null;
  attr_os_family: string | null;
  classification_manual: number | null;
}

export interface CellaContesa {
  fonte: AttributionSource;
  valore: string;
  /** 0-100, come la confidenza mostrata altrove. */
  confidenza: number;
  /** Il dato grezzo da cui viene: «Windows Server 2022», il prefisso del MAC. */
  dettaglio: string | null;
}

export interface RigaContesa {
  host_id: number;
  ip: string;
  hostname: string | null;
  dimensione: AttributionDimension;
  attuale: string | null;
  /** Gia' deciso a mano: si vede, non si sceglie (la scheda dell'host resta il posto per cambiarlo). */
  manuale: boolean;
  celle: CellaContesa[];
}

export interface ElencoContesi {
  righe: RigaContesa[];
  /** Le fonti che compaiono nelle righe, dalla piu' pesante: sono le colonne. */
  fonti: AttributionSource[];
  totale: number;
  host_valutati: number;
}

export interface SceltaConteso {
  host_id: number;
  dimensione: AttributionDimension;
  valore: string;
}

export interface EsitoScelte {
  applicate: number;
  rifiutate: Array<{ host_id: number; dimensione: AttributionDimension; motivo: string }>;
}

/** Stesso filtro di `fuse.ts`: `expires_at` e' sempre ISO, il confronto e' lessicografico. */
function attive(righe: AttributionEvidenceRow[], nowIso: string): AttributionEvidenceRow[] {
  return righe.filter((e) => e.expires_at == null || e.expires_at > nowIso);
}

/** `compute` accanto a `compute.server` e' la stessa cosa detta meno bene: resta la foglia. */
function categorieInContrasto(claim: string[]): string[] {
  const valide = claim.filter((c): c is CategorySlug => isValidCategory(c) && c !== "unknown");
  const radiciConFoglie = new Set(
    valide.filter((c) => categoryDepth(c) === 2).map((c) => categoryParent(c)),
  );
  return valide.filter((c) => categoryDepth(c) === 2 || !radiciConFoglie.has(c as never));
}

/** `proxmox` e `proxmox-server-solutions` sono lo stesso produttore: conta il nome piu' corto. */
function produttoriInContrasto(claim: string[]): string[] {
  const radici: string[] = [];
  for (const c of [...claim].sort((a, b) => a.length - b.length)) {
    if (!radici.some((r) => c === r || c.startsWith(`${r}-`))) radici.push(c);
  }
  return radici;
}

export function valoriInContrasto(dimensione: AttributionDimension, claim: string[]): string[] {
  const distinti = [...new Set(claim)];
  if (dimensione === "category") return categorieInContrasto(distinti);
  if (dimensione === "vendor") return produttoriInContrasto(distinti);
  return distinti;
}

function attualeDi(host: HostContesoRiga, dimensione: AttributionDimension): string | null {
  if (dimensione === "category") return host.attr_category;
  if (dimensione === "os") return host.attr_os_family;
  return host.attr_vendor;
}

function eManuale(host: HostContesoRiga, dimensione: AttributionDimension, righe: AttributionEvidenceRow[]): boolean {
  /* `classification_manual` e' fissato a mano e `persist.ts` non lo tocca mai: una scelta
   * di categoria qui non arriverebbe alla classificazione. */
  if (dimensione === "category" && host.classification_manual === 1) return true;
  return righe.some((e) => e.source === "manual");
}

/** Una cella per fonte e valore: Wazuh dice «windows» quattro volte, basta la piu' sicura. */
function celleDi(righe: AttributionEvidenceRow[]): CellaContesa[] {
  const perChiave = new Map<string, CellaContesa>();
  for (const e of righe) {
    if (e.source === "manual") continue;
    const chiave = `${e.source} ${e.claim}`;
    const confidenza = Math.round(e.confidence * 100);
    const gia = perChiave.get(chiave);
    if (!gia || confidenza > gia.confidenza) {
      perChiave.set(chiave, { fonte: e.source, valore: e.claim, confidenza, dettaglio: e.raw_value });
    }
  }
  return [...perChiave.values()];
}

export function ipNumerico(ip: string): number {
  return ip.split(".").reduce((acc, parte) => acc * 256 + (Number(parte) || 0), 0);
}

/** Pura: dalle evidenze alle righe della tabella. */
export function trovaContesi(
  host: HostContesoRiga[],
  evidenze: AttributionEvidenceRow[],
  nowIso: string,
  opzioni: { includiManuali?: boolean; limite?: number } = {},
): ElencoContesi {
  const vive = attive(evidenze, nowIso);
  const perHost = new Map<number, AttributionEvidenceRow[]>();
  for (const e of vive) {
    const lista = perHost.get(e.host_id);
    if (lista) lista.push(e);
    else perHost.set(e.host_id, [e]);
  }

  const righe: RigaContesa[] = [];
  for (const h of host) {
    const dellHost = perHost.get(h.id) ?? [];
    for (const dimensione of ORDINE_DIMENSIONI) {
      const dellaDimensione = dellHost.filter((e) => e.dimension === dimensione);
      const dalleFonti = dellaDimensione.filter((e) => e.source !== "manual").map((e) => e.claim);
      if (valoriInContrasto(dimensione, dalleFonti).length < 2) continue;
      const manuale = eManuale(h, dimensione, dellaDimensione);
      if (manuale && !opzioni.includiManuali) continue;
      righe.push({
        host_id: h.id, ip: h.ip, hostname: h.hostname, dimensione,
        attuale: attualeDi(h, dimensione), manuale, celle: celleDi(dellaDimensione),
      });
    }
  }

  righe.sort((a, b) =>
    ipNumerico(a.ip) - ipNumerico(b.ip)
    || ORDINE_DIMENSIONI.indexOf(a.dimensione) - ORDINE_DIMENSIONI.indexOf(b.dimensione));

  const limite = opzioni.limite ?? LIMITE_RIGHE_CONTESI;
  const mostrate = righe.slice(0, limite);
  const fonti = [...new Set(mostrate.flatMap((r) => r.celle.map((c) => c.fonte)))]
    .sort((a, b) => ATTR_SOURCE_WEIGHTS[b] - ATTR_SOURCE_WEIGHTS[a] || a.localeCompare(b));
  return { righe: mostrate, fonti, totale: righe.length, host_valutati: host.length };
}

/** Le righe di una rete, con un'unica lettura delle evidenze (niente N+1 per host). */
export function leggiContesiDiRete(
  dbh: Database.Database,
  networkId: number,
  nowIso: string,
  opzioni: { includiManuali?: boolean; limite?: number } = {},
): ElencoContesi {
  const host = dbh.prepare(
    `SELECT id, ip, hostname, attr_vendor, attr_category, attr_os_family, classification_manual
     FROM hosts WHERE network_id = ?`,
  ).all(networkId) as HostContesoRiga[];
  const evidenze = dbh.prepare(
    `SELECT e.* FROM attribution_evidence e
     JOIN hosts h ON h.id = e.host_id
     WHERE h.network_id = ? AND e.superseded_by IS NULL`,
  ).all(networkId) as AttributionEvidenceRow[];
  return trovaContesi(host, evidenze, nowIso, opzioni);
}

/**
 * Applica le scelte come evidenze `manual`: `fuse.ts` le fa vincere sempre, quindi le
 * scansioni successive non cambiano piu' quel dato. Si accettano solo valori che una
 * fonte ha davvero detto per quell'host: la tabella non e' un campo libero.
 */
export function applicaScelteContesi(
  dbh: Database.Database,
  scelte: SceltaConteso[],
  segnaliDi: (hostId: number) => AttributionSignals | null,
  nowIso: string,
): EsitoScelte {
  const esito: EsitoScelte = { applicate: 0, rifiutate: [] };
  const perHost = new Map<number, SceltaConteso[]>();
  for (const s of scelte) {
    const lista = perHost.get(s.host_id);
    if (lista) lista.push(s);
    else perHost.set(s.host_id, [s]);
  }

  const hostStmt = dbh.prepare(
    `SELECT id, ip, hostname, attr_vendor, attr_category, attr_os_family, classification_manual
     FROM hosts WHERE id = ?`,
  );
  for (const [hostId, dellHost] of perHost) {
    const rifiuta = (s: SceltaConteso, motivo: string) =>
      esito.rifiutate.push({ host_id: hostId, dimensione: s.dimensione, motivo });
    const host = hostStmt.get(hostId) as HostContesoRiga | undefined;
    const segnali = host ? segnaliDi(hostId) : null;
    if (!host || !segnali) {
      for (const s of dellHost) rifiuta(s, "host non trovato");
      continue;
    }
    const vive = attive(getActiveEvidence(dbh, hostId), nowIso);
    const input: EvidenceInput[] = [];
    for (const s of dellHost) {
      const dellaDimensione = vive.filter((e) => e.dimension === s.dimensione);
      if (eManuale(host, s.dimensione, dellaDimensione)) {
        rifiuta(s, "dato gia' deciso a mano");
        continue;
      }
      const detta = dellaDimensione.find((e) => e.claim === s.valore);
      if (!detta) {
        rifiuta(s, "valore non detto da nessuna fonte per questo host");
        continue;
      }
      input.push({
        source: "manual", phase: "manual", dimension: s.dimensione, claim: s.valore,
        confidence: 1, raw_value: detta.raw_value,
      });
    }
    if (input.length === 0) continue;
    recordEvidence(dbh, hostId, input);
    recomputeHostAttribution(dbh, segnali, "manual");
    esito.applicate += input.length;
  }
  return esito;
}
