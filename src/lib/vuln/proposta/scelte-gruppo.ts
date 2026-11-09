/**
 * Archivio della scelta per gruppo (09/11/2026, tavola 45-48). Le regole pure stanno in `scelte-gruppo-regole.ts`.
 */
import { getDb } from "@/lib/db";
import { FAMIGLIE_SCEGLIBILI, MODULI_SCELTA, NUCLEI_SCELTA, PROFILI_SCELTA, type SceltaGruppo, type ValoriScelta } from "./scelte-gruppo-regole";
import type { Famiglia } from "./regole";
export * from "./scelte-gruppo-regole";

interface Riga { famiglia: string; profile: string | null; nuclei: string | null; moduli: string | null; chi: string; nota: string | null; il: string }

function tra<T extends string>(x: string | null, ammessi: readonly T[]): T | null {
  return x !== null && (ammessi as readonly string[]).includes(x) ? (x as T) : null;
}

export function leggiScelte(networkId: number): SceltaGruppo[] {
  const righe = getDb().prepare(`SELECT famiglia, profile, nuclei, moduli, chi, nota, il FROM va_scelte_gruppo WHERE network_id = ? LIMIT 20`).all(networkId) as Riga[];
  return righe.flatMap((r) => (FAMIGLIE_SCEGLIBILI as readonly string[]).includes(r.famiglia)
    ? [{ famiglia: r.famiglia as Famiglia, profile: tra(r.profile, PROFILI_SCELTA), nuclei: tra(r.nuclei, NUCLEI_SCELTA), moduli: tra(r.moduli, MODULI_SCELTA), chi: r.chi, nota: r.nota, il: r.il }]
    : []);
}

/** Salva la scelta della famiglia sulla rete (tutti i campi insieme). Chi chiama ha già fatto `controllaScelta`. */
export function salvaScelta(networkId: number, s: ValoriScelta & { famiglia: Famiglia }, chi: string, nota: string | null): void {
  getDb().prepare(
    `INSERT INTO va_scelte_gruppo (network_id, famiglia, profile, nuclei, moduli, chi, nota, il) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(network_id, famiglia) DO UPDATE SET profile = excluded.profile, nuclei = excluded.nuclei, moduli = excluded.moduli,
       chi = excluded.chi, nota = excluded.nota, il = excluded.il`,
  ).run(networkId, s.famiglia, s.profile, s.nuclei, s.moduli, chi, nota);
}

/** «↺ Torna alla tabella». */
export function togliScelta(networkId: number, famiglia: Famiglia): boolean {
  return getDb().prepare(`DELETE FROM va_scelte_gruppo WHERE network_id = ? AND famiglia = ?`).run(networkId, famiglia).changes > 0;
}
