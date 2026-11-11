/**
 * Recinto dell'utente «Cliente». Pura: niente Next, niente database.
 * Chi non ha il segno passa sempre. Chi ce l'ha resta in /cliente,
 * può parlare con /api/auth, e sulle altre API riceve un rifiuto.
 */
export type EsitoRecinto = "passa" | "vai_a_cliente" | "vietato";

/**
 * vistaCliente === false → sempre "passa".
 * vistaCliente === true:
 *   - percorso === "/cliente" o comincia con "/cliente/"  → "passa"
 *   - comincia con "/api/auth"                             → "passa"
 *   - comincia con "/api/"                                 → "vietato"
 *   - ogni altro percorso                                  → "vai_a_cliente"
 */
export function recinto(vistaCliente: boolean, percorso: string): EsitoRecinto {
  if (!vistaCliente) return "passa";
  if (percorso === "/cliente" || percorso.startsWith("/cliente/")) return "passa";
  if (percorso.startsWith("/api/auth")) return "passa";
  if (percorso.startsWith("/api/")) return "vietato";
  return "vai_a_cliente";
}
