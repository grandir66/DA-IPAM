/**
 * Sessione e istanza (Riccardo, 23/10). Tre regole, usate dai callback di Auth.js
 * (`auth.config.ts`) e dall'accesso (`auth.ts`):
 *
 * - **Uscita vera**: «Esci» segna l'ora su `users.sessioni_valide_da` e un token nato da un
 *   accesso precedente non vale più. Senza, le richieste della dashboard partite prima
 *   dell'uscita tornavano dopo e rimettevano il cookie (il JWT si rinnova a ogni risposta).
 *   Esce da tutti i browser dell'utente.
 * - **Cambio d'istanza controllato**: si passa solo alle istanze dell'utente; la vista
 *   «tutte» solo al superadmin. Prima il browser poteva chiedere qualsiasi codice.
 * - **Ultima istanza**: si ricorda in `users.ultima_istanza` e all'accesso si riparte da lì,
 *   se l'accesso c'è ancora; altrimenti come prima (superadmin → «tutte»).
 *
 * L'utente di servizio (`DOMARC_USERNAME`, id 0) non ha una riga: niente uscita segnata né
 * ultima istanza, solo il controllo dell'istanza (è superadmin).
 */
import { getActiveTenants, getHubDb, getTenantByCode, getUserTenantAccess, type HubUser } from "@/lib/db-hub";

/** La vista aggregata del superadmin: non è un'istanza. */
export const VISTA_TUTTE = "__ALL__";

export type IstanzaInSessione = { code: string; name: string; role: string };

/** Le istanze che l'utente può aprire, come le porta la sessione. */
export function istanzeDi(user: Pick<HubUser, "id" | "role">): IstanzaInSessione[] {
  if (user.role === "superadmin") {
    return getActiveTenants().map((t) => ({ code: t.codice_cliente, name: t.ragione_sociale, role: "superadmin" }));
  }
  return getUserTenantAccess(user.id).map((t) => ({ code: t.codice_cliente, name: t.ragione_sociale, role: t.role }));
}

/** Decide sul cambio d'istanza chiesto dal browser. Legge gli accessi dal DB, non dal token. */
export function istanzaAmmessa(userId: number | null, ruolo: string | undefined, richiesta: string): boolean {
  if (richiesta === VISTA_TUTTE) return ruolo === "superadmin";
  if (ruolo === "superadmin") return getTenantByCode(richiesta)?.active === 1;
  if (!userId) return false;
  return getUserTenantAccess(userId).some((a) => a.codice_cliente === richiesta);
}

/** L'istanza con cui si entra: l'unica, poi l'ultima usata se è ancora ammessa, poi come prima. */
export function istanzaIniziale(
  user: Pick<HubUser, "role"> & { ultima_istanza?: string | null },
  lista: IstanzaInSessione[],
): string | null {
  if (lista.length === 1) return lista[0].code;
  const ultima = user.ultima_istanza;
  if (ultima) {
    if (ultima === VISTA_TUTTE ? user.role === "superadmin" : lista.some((t) => t.code === ultima)) return ultima;
  }
  return user.role === "superadmin" ? VISTA_TUTTE : null;
}

export function segnaUltimaIstanza(userId: number, codice: string): void {
  getHubDb().prepare("UPDATE users SET ultima_istanza = ? WHERE id = ?").run(codice, userId);
}

/** «Esci»: da adesso i token degli accessi precedenti non valgono più (millisecondi). */
export function segnaUscita(userId: number, ora: number = Date.now()): void {
  getHubDb().prepare("UPDATE users SET sessioni_valide_da = ? WHERE id = ?").run(ora, userId);
}

/**
 * Il token nato dall'accesso delle `accessoAt` è stato chiuso da un'uscita successiva?
 * Un token senza `accessoAt` (emesso prima di questa versione) vale finché l'utente non esce.
 */
export function sessioneRevocata(userId: number, accessoAt: number | undefined): boolean {
  const riga = getHubDb().prepare("SELECT sessioni_valide_da FROM users WHERE id = ?").get(userId) as
    | { sessioni_valide_da: number | null }
    | undefined;
  if (!riga?.sessioni_valide_da) return false;
  return (accessoAt ?? 0) <= riga.sessioni_valide_da;
}
