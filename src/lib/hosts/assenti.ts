/**
 * «Assente» (Riccardo, 20/10): un host offline non visto da più di ASSENTE_DOPO_GIORNI
 * giorni. Non conta fra gli offline nella salute della dashboard né nel grafico «Stato
 * host nel tempo»: sull'hub 115 dei 178 offline non si vedevano da giorni o mesi, e la
 * salute in alto (51%) non coincideva con quella del grafico (98%).
 * `last_seen` è nel formato di SQLite: il confronto con datetime('now') è sicuro.
 */
export const ASSENTE_DOPO_GIORNI = 7;

/** Condizione SQL su `hosts` (alias facoltativo). */
export function condizioneAssente(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}status = 'offline' AND (${a}last_seen IS NULL OR ${a}last_seen < datetime('now', '-${ASSENTE_DOPO_GIORNI} days')))`;
}
