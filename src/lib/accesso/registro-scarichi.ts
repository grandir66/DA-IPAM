import type Database from "better-sqlite3";

/**
 * Registro degli scarichi di dati dall'istanza (piano di sicurezza 14/11, P0-1).
 * Il journal si perde con la rotazione; questa tabella dice chi ha portato fuori cosa, e quando.
 */
export type CosaScaricata = "hub_db" | "pacchetto";

export interface Scarico {
  cosa: CosaScaricata;
  utenteId?: string | null;
  utenteNome?: string | null;
  ruolo?: string | null;
  dettaglio?: string | null;
}

/** Non lancia mai: un registro che non si scrive non deve impedire un backup, ma si vede nel journal. */
export function registraScarico(db: Database.Database, s: Scarico): void {
  try {
    db.prepare(
      "INSERT INTO scarichi_dati (cosa, utente_id, utente_nome, ruolo, dettaglio) VALUES (?, ?, ?, ?, ?)",
    ).run(s.cosa, s.utenteId ?? null, s.utenteNome ?? null, s.ruolo ?? null, s.dettaglio ?? null);
  } catch (e) {
    console.error("[scarichi] registro non scritto:", e);
  }
}

/** L'ultimo scarico di quel tipo, con l'ora in ISO (UTC). */
export function ultimoScarico(
  db: Database.Database,
  cosa: CosaScaricata,
): { quando: string; utente: string | null } | null {
  const r = db
    .prepare("SELECT quando, utente_nome FROM scarichi_dati WHERE cosa = ? ORDER BY id DESC LIMIT 1")
    .get(cosa) as { quando: string; utente_nome: string | null } | undefined;
  if (!r) return null;
  return { quando: `${r.quando.replace(" ", "T")}Z`, utente: r.utente_nome };
}
