/**
 * Parsing JSON difensivo (WAVE 3 / W3-1).
 *
 * `JSON.parse` nudo lancia su input malformato: una colonna JSON sporca nel DB
 * o un body request corrotto fa crashare l'intera request con 500. Questo helper
 * ritorna un fallback invece di lanciare, così il path degrada senza rompere.
 *
 * Regola di progetto (api-routes.md #5): niente `JSON.parse` nudo nelle API.
 * Usare `parseJsonSafe` per colonne DB e body opzionali; per body obbligatori
 * preferire comunque una validazione Zod a valle.
 */

/**
 * Parsa `raw` come JSON; ritorna `fallback` se è null/undefined/vuoto o non valido.
 * @param raw stringa (o null/undefined) da parsare
 * @param fallback valore restituito su input assente o non parsabile
 */
export function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Variante che ritorna `null` invece di un fallback tipato — comoda quando il
 * chiamante vuole distinguere "assente/non valido" da un valore di default.
 */
export function tryParseJson<T>(raw: string | null | undefined): T | null {
  return parseJsonSafe<T | null>(raw, null);
}
