/**
 * «Sicurezza del dominio» e «Health Active Directory» in una voce sola (Riccardo, 08/11/2026, su
 * tutte le installazioni). La pagina /sicurezza-dominio ha due schede; la Health, che prima era
 * una scheda della pagina Active Directory, sta lì. Prova: `__tests__/sicurezza-dominio-unita.test.ts`.
 */
export type SchedaSicurezzaDominio = "eventi" | "health";

export function schedaSicurezzaDominio(tab: string | null): SchedaSicurezzaDominio {
  return tab === "health" ? "health" : "eventi";
}

/** Il vecchio indirizzo /active-directory?tab=health (link salvati, cruscotto) porta alla scheda nuova. */
export function indirizzoHealthSpostata(tab: string | null): string | null {
  return tab === "health" ? "/sicurezza-dominio?tab=health" : null;
}
