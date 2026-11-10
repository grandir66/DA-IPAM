/**
 * Triage dei rilievi: stato (da fare / in corso / fatto / ignorato) e nota per chiave di
 * rilievo (`CVE-…` o `nvt:…`). La logica sta qui; `db-tenant.ts` la chiama col DB del tenant
 * corrente, `db.ts` (facade) la riesporta. Una copia sola (regola 12 di CLAUDE.md).
 */
import type Database from "better-sqlite3";

export const STATI_TRIAGE = ["da_fare", "in_corso", "fatto", "ignorato"] as const;
export type StatoTriage = (typeof STATI_TRIAGE)[number];

export interface RigaTriage {
  chiave: string;
  stato: StatoTriage;
  nota: string;
  aggiornato_il: string;
  aggiornato_da: string | null;
}

export function isStatoTriage(v: unknown): v is StatoTriage {
  return typeof v === "string" && (STATI_TRIAGE as readonly string[]).includes(v);
}

/** Il triage delle chiavi date, come mappa chiave→riga. Chiavi senza triage non compaiono. */
export function getTriage(db: Database.Database, chiavi: string[]): Record<string, RigaTriage> {
  const out: Record<string, RigaTriage> = {};
  if (chiavi.length === 0) return out;
  // A blocchi: SQLite ha un tetto ai parametri (999).
  for (let i = 0; i < chiavi.length; i += 400) {
    const blocco = chiavi.slice(i, i + 400);
    const segni = blocco.map(() => "?").join(",");
    const righe = db
      .prepare(`SELECT chiave, stato, nota, aggiornato_il, aggiornato_da FROM triage_rilievi WHERE chiave IN (${segni})`)
      .all(...blocco) as RigaTriage[];
    for (const r of righe) out[r.chiave] = r;
  }
  return out;
}

/** I conteggi per stato, su tutto il tenant (per le tessere in testata). */
export function conteggiTriage(db: Database.Database): Record<StatoTriage, number> {
  const base: Record<StatoTriage, number> = { da_fare: 0, in_corso: 0, fatto: 0, ignorato: 0 };
  const righe = db.prepare("SELECT stato, COUNT(*) AS n FROM triage_rilievi GROUP BY stato").all() as Array<{ stato: string; n: number }>;
  for (const r of righe) if (isStatoTriage(r.stato)) base[r.stato] = r.n;
  return base;
}

/**
 * Scrive stato e nota di una chiave. `da_fare` con nota vuota = torna allo stato di partenza,
 * quindi la riga si cancella (così i conteggi e «N di M rivisti» restano veri).
 */
export function setTriage(db: Database.Database, chiave: string, stato: StatoTriage, nota: string, utente: string | null): void {
  const notaPulita = nota.trim().slice(0, 4000);
  if (stato === "da_fare" && notaPulita === "") {
    db.prepare("DELETE FROM triage_rilievi WHERE chiave = ?").run(chiave);
    return;
  }
  db.prepare(
    `INSERT INTO triage_rilievi (chiave, stato, nota, aggiornato_il, aggiornato_da)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(chiave) DO UPDATE SET stato = excluded.stato, nota = excluded.nota,
       aggiornato_il = excluded.aggiornato_il, aggiornato_da = excluded.aggiornato_da`,
  ).run(chiave, stato, notaPulita, utente);
}

/**
 * Imposta lo stesso stato su più chiavi in una sola transazione, **preservando la nota** di ciascuna
 * (il blocco cambia lo stato, non la nota). Riusa `setTriage`, così vale ancora la regola «da_fare con
 * nota vuota = la riga si cancella» e i conteggi di «N di M rivisti» restano veri.
 */
export function setTriageStatoBlocco(db: Database.Database, chiavi: string[], stato: StatoTriage, utente: string | null): void {
  if (chiavi.length === 0) return;
  const esistenti = getTriage(db, chiavi);
  const tx = db.transaction(() => {
    for (const chiave of chiavi) {
      setTriage(db, chiave, stato, esistenti[chiave]?.nota ?? "", utente);
    }
  });
  tx();
}
