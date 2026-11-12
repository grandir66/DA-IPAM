/**
 * Controllo della classificazione sul database (12/11/2026): legge le righe, applica le regole di `controllo.ts`
 * e, a richiesta, rilancia il motore su tutte. La lettura non scrive niente.
 */
import type Database from "better-sqlite3";
import { recomputeAttributionForDb } from "@/lib/attribution/recompute";
import { macPrivato } from "@/lib/hosts/cambio-inquilino";
import { controlla, type Rilievo, type RigaControllo } from "./controllo";

export interface VoceControllo {
  host_id: number;
  network_id: number | null;
  ip: string;
  nome: string | null;
  vendor: string | null;
  classe_adesso: string | null;
  a_mano: boolean;
  rilievo: Rilievo;
}

interface RigaDb {
  id: number; network_id: number | null; ip: string; nome: string | null; mac: string | null; vendor: string | null;
  os_info: string | null; open_ports: string | null; classification: string | null; classification_manual: number | null;
}

const LEGGI = `SELECT id, network_id, ip, COALESCE(NULLIF(custom_name,''), NULLIF(hostname,''), NULLIF(dns_reverse,'')) AS nome,
                      mac, vendor, os_info, open_ports, classification, classification_manual
               FROM hosts ORDER BY id`;

function porte(json: string | null): number[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((p) => Number((p as { port?: unknown }).port)).filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

const chiaveNome = (n: string | null): string => (n ?? "").trim().toLowerCase().split(".")[0];

/** Le righe col loro contesto (quante hanno lo stesso nome, con quanti MAC veri). */
export function righeDaControllare(db: Database.Database): Array<RigaControllo & { network_id: number | null }> {
  const righe = db.prepare(LEGGI).all() as RigaDb[];
  const perNome = new Map<string, number>();
  const macVeri = new Map<string, Set<string>>();
  for (const r of righe) {
    const k = chiaveNome(r.nome);
    if (!k) continue;
    perNome.set(k, (perNome.get(k) ?? 0) + 1);
    if (r.mac && !macPrivato(r.mac)) macVeri.set(k, (macVeri.get(k) ?? new Set<string>()).add(r.mac.toUpperCase()));
  }
  return righe.map((r) => ({
    id: r.id, network_id: r.network_id, ip: r.ip, nome: r.nome, mac: r.mac, vendor: r.vendor, os: r.os_info,
    porte: porte(r.open_ports), classeAdesso: r.classification, aMano: (r.classification_manual ?? 0) === 1,
    righeStessoNome: perNome.get(chiaveNome(r.nome)) ?? 1,
    macVeriStessoNome: macVeri.get(chiaveNome(r.nome))?.size ?? 0,
  }));
}

/** Sola lettura: i rilievi delle regole indipendenti sulla classe scritta oggi. */
export function leggiControllo(db: Database.Database): { righe: number; voci: VoceControllo[] } {
  const righe = righeDaControllare(db);
  const voci: VoceControllo[] = [];
  for (const r of righe) {
    for (const rilievo of controlla(r)) {
      voci.push({
        host_id: r.id, network_id: r.network_id, ip: r.ip, nome: r.nome, vendor: r.vendor,
        classe_adesso: r.classeAdesso && r.classeAdesso !== "unknown" ? r.classeAdesso : null, a_mano: r.aMano, rilievo,
      });
    }
  }
  return { righe: righe.length, voci };
}

/** Rilancia il motore di oggi su tutte le righe. Le scelte a mano le protegge il motore stesso. */
export function ricalcolaTutto(db: Database.Database): { righe: number; cambiate: number; fallite: number } {
  const classi = () => new Map((db.prepare("SELECT id, classification FROM hosts").all() as Array<{ id: number; classification: string | null }>)
    .map((r) => [r.id, r.classification && r.classification !== "unknown" ? r.classification : null]));
  const prima = classi();
  let fallite = 0;
  for (const id of prima.keys()) {
    if (recomputeAttributionForDb(db, id, "backfill") === null) fallite++;
  }
  const dopo = classi();
  let cambiate = 0;
  for (const [id, c] of prima) if ((dopo.get(id) ?? null) !== c) cambiate++;
  return { righe: prima.size, cambiate, fallite };
}
