/**
 * Identità da DA-Auth (auth.domarc.it), il servizio di autenticazione del parco.
 *
 * Perché passare di lì invece di registrare DA-IPAM su Entra: DA-Auth conosce
 * già i nostri utenti, sa dire il ruolo **su questa applicazione**, tiene il
 * registro degli ingressi (compresi quelli falliti) e permette di entrare con
 * Microsoft+MFA, con le credenziali di dominio o col PIN. Una registrazione
 * Entra per ogni applicazione darebbe solo la prima di queste cose.
 *
 * Il cookie di DA-Auth è emesso su `.domarc.it` e questa applicazione sta su
 * `da-ipam.domarc.it`: il browser lo manda già, non c'è niente da configurare.
 * Noi lo giriamo a `/whoami`, che risponde **sempre 200** con gli header
 * dell'identità valorizzati o assenti — non è una guardia, dice solo chi è chi.
 *
 * ⚠️ Questo modulo dà l'IDENTITÀ, non i permessi. Chi entra da qui deve
 * comunque esistere in `users` di DA-IPAM: ruolo e tenant restano quelli della
 * sua riga locale (vedi `auth.ts`). DA-Auth parla di ruoli suoi
 * (`readonly`/`standard`/`admin`…), DA-IPAM di ruoli suoi più l'accesso per
 * tenant: tradurre gli uni negli altri in silenzio significherebbe inventare
 * una corrispondenza che nessuno ha deciso, e nella direzione sbagliata
 * darebbe a qualcuno più di quello che ha oggi.
 */

/** Il nome del cookie di sessione di DA-Auth. */
export const DAAUTH_COOKIE = "da_auth";

/**
 * Come questa applicazione si dichiara a DA-Auth.
 * Deve combaciare con la chiave in `servizio/applicazioni.py` di DA-Auth:
 * un valore sconosciuto non dà errore, fa solo tornare il ruolo generale.
 */
export const APPLICAZIONE = "ipam";

export function urlDaAuth(): string {
  return (process.env.DAAUTH_URL || "https://auth.domarc.it").replace(/\/+$/, "");
}

/** Dove mandare chi sceglie «Accedi con l'account Domarc». */
export function urlAccessoDomarc(ritorno: string): string {
  return `${urlDaAuth()}/?da=${APPLICAZIONE}&ritorno=${encodeURIComponent(ritorno)}`;
}

/**
 * Estrae il cookie di DA-Auth dall'header `Cookie`.
 *
 * Scritto a mano e non con una regex generosa: `da_auth` deve combaciare per
 * intero, altrimenti un cookie chiamato `non_da_auth` verrebbe scambiato per
 * quello buono.
 */
export function cookieDaAuth(header: string | null | undefined): string {
  if (!header) return "";
  for (const pezzo of header.split(";")) {
    const eq = pezzo.indexOf("=");
    if (eq < 0) continue;
    if (pezzo.slice(0, eq).trim() === DAAUTH_COOKIE) {
      return pezzo.slice(eq + 1).trim();
    }
  }
  return "";
}

export type IdentitaDomarc = { username: string; role: string };

/**
 * Chi è la persona dietro il cookie di DA-Auth, o `null`.
 *
 * Non solleva mai, nemmeno se DA-Auth è irraggiungibile: restituisce `null`,
 * e chi chiama mostra il login locale. È la ragione per cui quello non è stato
 * spento — se il servizio di identità cade, si entra lo stesso.
 */
export async function identitaDaAuth(
  cookieHeader: string | null | undefined,
  timeoutMs = 6000,
): Promise<IdentitaDomarc | null> {
  const cookie = cookieDaAuth(cookieHeader);
  if (!cookie) return null;

  const stop = AbortSignal.timeout(timeoutMs);
  try {
    const r = await fetch(`${urlDaAuth()}/whoami`, {
      headers: {
        cookie: `${DAAUTH_COOKIE}=${cookie}`,
        // Con quale applicazione stiamo chiedendo: è così che DA-Auth risponde
        // col ruolo di QUESTA e non con quello generale.
        "x-applicazione": APPLICAZIONE,
      },
      cache: "no-store",
      signal: stop,
    });
    const username = (r.headers.get("x-user") || "").trim();
    if (!username) return null;
    return { username, role: (r.headers.get("x-role") || "").trim() };
  } catch {
    // Irraggiungibile, lento, o risposta illeggibile: «non lo so», non un errore.
    return null;
  }
}
