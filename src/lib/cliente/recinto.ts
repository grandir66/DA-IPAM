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
 *   - GET su una lettura della topologia (elenco sotto)    → "passa"
 *   - comincia con "/api/"                                 → "vietato"
 *   - ogni altro percorso                                  → "vai_a_cliente"
 */
/**
 * Le letture che servono alla mappa in sola lettura di /cliente (Riccardo, 12/11/2026). Solo GET, percorso esatto:
 * le scritture stanno sulle stesse rotte e restano vietate (e chiedono comunque l'amministratore).
 */
const LETTURE_TOPOLOGIA = /^\/api\/topology\/(model|maps|maps\/[^/]+|links|ports)$/;
/** Le letture dei due widget della Dashboard che si caricano dal browser: «Stato host nel tempo» e «Transizioni recenti». */
const LETTURE_STATO = /^\/api\/status\/(chart-detailed|changes)$/;

export function recinto(vistaCliente: boolean, percorso: string, metodo?: string): EsitoRecinto {
  if (!vistaCliente) return "passa";
  if (percorso === "/cliente" || percorso.startsWith("/cliente/")) return "passa";
  if (percorso.startsWith("/api/auth")) return "passa";
  if (metodo === "GET" && (LETTURE_TOPOLOGIA.test(percorso) || LETTURE_STATO.test(percorso))) return "passa";
  if (percorso.startsWith("/api/")) return "vietato";
  return "vai_a_cliente";
}
