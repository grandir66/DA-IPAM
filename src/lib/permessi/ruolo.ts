/**
 * Chi può usare un'azione riservata agli amministratori, lato interfaccia
 * (analisi del 19/10, F07).
 *
 * Il server rifiuta già (requireAdmin): questa regola serve a non offrire al
 * viewer pulsanti che aprono un dialogo e finiscono in «Richiesti privilegi di
 * amministratore». Una funzione sola, invece di un `role === "admin" || …`
 * copiato in ogni pagina. Modulo puro: lo usano i componenti client.
 */
export type Ruolo = "superadmin" | "admin" | "viewer";

export function eAdmin(ruolo: string | null | undefined): boolean {
  return ruolo === "admin" || ruolo === "superadmin";
}
