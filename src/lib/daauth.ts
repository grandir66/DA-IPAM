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
 * ⚠️ **È un'opzione, e nasce spenta.** DA-INVENT è installato anche presso i
 * clienti, su appliance che non hanno — e non devono avere — un servizio di
 * autenticazione Domarc da contattare. Il freno è la variabile `DAAUTH_URL`:
 * se non è impostata la funzione non esiste, il bottone non compare e
 * l'installazione si comporta esattamente come prima. Non c'è un valore
 * predefinito, di proposito: un default puntato su `auth.domarc.it` farebbe
 * comparire su ogni appliance di cliente un bottone che tenta di parlare con
 * un nostro servizio.
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

/**
 * L'indirizzo del servizio di autenticazione, o `""` se non è configurato.
 *
 * **Nessun valore predefinito**: è il freno che tiene la funzione spenta sulle
 * installazioni dei clienti.
 */
export function urlDaAuth(): string {
  return (process.env.DAAUTH_URL || "").trim().replace(/\/+$/, "");
}

/** Se l'accesso con l'account Domarc è disponibile su questa installazione. */
export function accessoDomarcAttivo(): boolean {
  return urlDaAuth() !== "";
}

/**
 * Dove mandare chi sceglie «Accedi con l'account Domarc», o `""` se spento.
 *
 * `base` si passa esplicitamente perché questa funzione serve anche al
 * browser, dove `process.env.DAAUTH_URL` non esiste: la pagina di accesso
 * riceve l'indirizzo da `/api/setup`, che lo legge dall'ambiente del server.
 */
export function urlAccessoDomarc(base: string, ritorno: string): string {
  const pulito = (base || "").trim().replace(/\/+$/, "");
  if (!pulito) return "";
  return `${pulito}/?da=${APPLICAZIONE}&ritorno=${encodeURIComponent(ritorno)}`;
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

export type IdentitaDomarc = {
  username: string;
  /** Il ruolo su QUESTA applicazione, nel vocabolario di DA-Auth. */
  role: string;
  /**
   * Qualcuno ha dichiarato in DA-Auth che questa persona usa questa
   * applicazione. È l'unica cosa che autorizza a creare l'utenza locale
   * mancante: senza, si rifiuta come si è sempre fatto.
   */
  dichiarato: boolean;
};

/** Cosa diventa, qui, una persona dichiarata con un certo ruolo Domarc. */
export type Traduzione = {
  /** Il ruolo di DA-INVENT: `superadmin` vede tutti i tenant per definizione. */
  ruolo: "superadmin" | "admin" | "viewer";
  /**
   * I clienti a cui dare accesso, per **codice**. Vuoto significa nessuno: si
   * entra e non si vede niente finché qualcuno non assegna un cliente da qui.
   * Un codice che non esiste viene saltato con un avviso, non fa fallire
   * l'accesso — ma nemmeno diventa «tutti».
   */
  tenant?: string[];
};

/**
 * Dal ruolo di DA-Auth a quello di qui. **Scritta in chiaro, non dedotta.**
 *
 * I due sistemi parlano vocabolari diversi e non si traducono da soli. Questa
 * tabella è una decisione, e sta qui — nell'applicazione che sa cosa
 * significano i propri ruoli e cos'è un tenant — non in DA-Auth, che non lo sa.
 *
 * Un ruolo che non compare qui **non si traduce**: la persona non viene creata
 * e si rifiuta. Non c'è un ripiego «al ruolo più basso»: se serve, si dichiara
 * quella persona su questa applicazione con un ruolo esplicito, che è
 * esattamente ciò per cui la dichiarazione esiste.
 *
 * `standard` e `commerciale` sono fuori di proposito: chi fa un altro mestiere
 * non entra in un inventario di rete per il fatto di lavorare qui.
 */
export const RUOLO_DOMARC_A_LOCALE: Readonly<Record<string, Traduzione>> = {
  // Amministratore del parco: vede tutti i clienti, senza elencarli.
  admin: { ruolo: "superadmin" },
  // Il tecnico vede Domarc — che è l'unico cliente vero qui dentro. Le due
  // righe sono lo stesso cliente: `70791` è la sede, `70791a` l'infrastruttura
  // a OVH (bridge remoto).
  tecnico_advanced: { ruolo: "admin", tenant: ["70791", "70791a"] },
  readonly: { ruolo: "viewer", tenant: ["70791", "70791a"] },
};

export function traduzionePer(ruoloDomarc: string): Traduzione | null {
  return RUOLO_DOMARC_A_LOCALE[(ruoloDomarc || "").trim()] ?? null;
}

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
  // Prima di tutto il freno: se l'opzione non è accesa qui non si contatta
  // nessuno, e non si guarda nemmeno il cookie.
  const base = urlDaAuth();
  if (!base) return null;

  const cookie = cookieDaAuth(cookieHeader);
  if (!cookie) return null;

  const stop = AbortSignal.timeout(timeoutMs);
  try {
    const r = await fetch(`${base}/whoami`, {
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
    return {
      username,
      role: (r.headers.get("x-role") || "").trim(),
      // L'intestazione c'è solo quando la dichiarazione esiste: l'assenza
      // significa «non dichiarato», non «non lo so».
      dichiarato: (r.headers.get("x-dichiarato") || "").trim() === "si",
    };
  } catch {
    // Irraggiungibile, lento, o risposta illeggibile: «non lo so», non un errore.
    return null;
  }
}
