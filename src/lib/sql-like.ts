/**
 * Ricerca «contiene» con LIKE di SQLite: `%`, `_` e `\` scritti dall'utente
 * valgono come caratteri, non come jolly. Da usare sempre con `LIKE_ESCAPE`:
 *   `col LIKE ? ${LIKE_ESCAPE}` con parametro `likeContains(testo)`.
 */
export const LIKE_ESCAPE = "ESCAPE '\\'";

export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
