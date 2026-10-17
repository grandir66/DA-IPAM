/**
 * Accesso a LibreNMS dal browser, deciso dal ruolo (T3-26, SEC-6 parte viewer).
 *
 * L'accesso automatico entra in LibreNMS con la password admin salvata
 * nell'hub: lo usa solo chi è almeno admin. Per gli altri il proxy inoltra
 * senza accesso automatico e senza i cookie di LibreNMS, e la rotta di accesso
 * automatico rimanda all'URL diretto, dove LibreNMS chiede il suo login.
 *
 * Qui solo decisioni con le dipendenze iniettate (niente database né rete):
 * le rotte passano le funzioni vere, le prove quelle finte.
 * Prove: `__tests__/librenms-accesso.test.ts`.
 */
import { puoUsareAccessoAutomatico } from "../permessi/politica";

/** Prefisso del reverse proxy verso LibreNMS. */
export const LIBRENMS_PROXY_BASE = "/api/integrations/proxy/librenms";

/** Rotta same-origin che fa l'accesso automatico e rimanda all'interfaccia. */
export const LIBRENMS_ACCESSO_AUTOMATICO_PATH = "/api/integrations/librenms/sso";

/** Vero se l'URL è la rotta di accesso automatico (assoluta o relativa). */
export function eUrlAccessoAutomaticoLibreNMS(url: string | null | undefined): boolean {
  const u = url?.trim();
  if (!u) return false;
  let percorso = u;
  try {
    percorso = new URL(u, "http://x").pathname;
  } catch {
    return false;
  }
  return percorso.replace(/\/+$/, "") === LIBRENMS_ACCESSO_AUTOMATICO_PATH;
}

/**
 * URL da mettere nei link verso LibreNMS. Il ruolo è obbligatorio e un ruolo
 * sconosciuto vale come viewer: in quel caso non si chiede nemmeno se
 * l'accesso automatico è acceso.
 */
export function scegliUrlOperatoreLibreNMS(
  urlDiretto: string,
  ruolo: unknown,
  accessoAutomaticoAttivo: () => boolean,
): string {
  if (!urlDiretto) return urlDiretto;
  if (!puoUsareAccessoAutomatico(ruolo)) return urlDiretto;
  return accessoAutomaticoAttivo() ? LIBRENMS_ACCESSO_AUTOMATICO_PATH : urlDiretto;
}

/** Toglie dall'intestazione Cookie la sessione e il token XSRF di LibreNMS. */
export function stripLibreNMSCookies(cookieHeader: string | null | undefined): string {
  if (!cookieHeader?.trim()) return "";
  return cookieHeader
    .split(";")
    .map((s) => s.trim())
    .filter((p) => p && !/^laravel_session=/i.test(p) && !/^XSRF-TOKEN=/i.test(p))
    .join("; ");
}

export function mergeCookieHeaders(a: string | null | undefined, b: string | null | undefined): string {
  const parts = [a, b].filter((x) => x?.trim());
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]}; ${parts[1]}`;
}

/**
 * Copia della richiesta coi cookie di LibreNMS sostituiti da `cookieLibreNMS`
 * (vuoto = tolti e basta). Gli altri cookie restano.
 */
export function richiestaConCookieLibreNMS(req: Request, cookieLibreNMS: string): Request {
  const headers = new Headers(req.headers);
  const altri = stripLibreNMSCookies(req.headers.get("cookie"));
  const cookie = mergeCookieHeaders(altri, cookieLibreNMS);
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");

  const init: RequestInit = { method: req.method, headers };
  if (req.body) {
    init.body = req.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }
  return new Request(req.url, init);
}

export interface DipendenzeProxyLibreNMS {
  /** Accesso automatico configurato (password admin e URL pubblico presenti). */
  accessoAutomaticoAttivo(): boolean;
  /** Login su LibreNMS con la password admin: cookie di sessione, o null. */
  cookieAccessoAutomatico(): Promise<string | null>;
  /** Inoltro a LibreNMS (reverse proxy già configurato). */
  inoltra(req: Request): Promise<Response>;
  /** Porta al browser i cookie dell'accesso automatico. */
  allegaCookie(resp: Response, cookie: string): Promise<Response>;
  /** Svuota la cache delle sessioni: il prossimo `cookieAccessoAutomatico` rifà il login. */
  svuotaCache?(): void;
}

const TESTO = { "content-type": "text/plain; charset=utf-8" };

/** Gestore del reverse proxy, dopo che la rotta ha verificato la sessione. */
export async function gestisciProxyLibreNMS(
  req: Request,
  ruolo: unknown,
  deps: DipendenzeProxyLibreNMS,
): Promise<Response> {
  // Accesso automatico spento: nessuna sessione admin da cui difendersi, la
  // richiesta passa così com'è e ognuno entra col proprio login di LibreNMS.
  if (!deps.accessoAutomaticoAttivo()) return deps.inoltra(req);
  if (!puoUsareAccessoAutomatico(ruolo)) {
    // Senza cookie di LibreNMS: una sessione nata da un accesso automatico
    // precedente (o di un altro utente sullo stesso browser) non passa.
    return deps.inoltra(richiestaConCookieLibreNMS(req, ""));
  }

  const cookie = await deps.cookieAccessoAutomatico();
  if (!cookie) {
    return new Response(
      "Accesso automatico a LibreNMS non disponibile: verifica la password admin in Impostazioni → Moduli → LibreNMS",
      { status: 502, headers: TESTO },
    );
  }

  const inoltrata = richiestaConCookieLibreNMS(req, cookie);
  let resp = await deps.inoltra(inoltrata);

  // Pagina di login dopo l'accesso automatico → home del proxy coi cookie.
  // Se è LibreNMS a rimandare al login, la sessione in cache non vale più
  // (scaduta o invalidata a monte): si svuota la cache e si rientra una volta
  // sola con un login nuovo (passo 4b, 16/10). Prima si riprovava col cookie
  // vecchio e si restava sul login fino a 45 minuti.
  const percorso = new URL(req.url).pathname;
  const rimandaAlLogin = resp.headers.get("location")?.includes("/login") ?? false;
  if (percorso.endsWith("/login") || rimandaAlLogin) {
    let valido = cookie;
    if (rimandaAlLogin && deps.svuotaCache) {
      deps.svuotaCache();
      const nuovo = await deps.cookieAccessoAutomatico();
      if (!nuovo) {
        return new Response(
          "Accesso automatico a LibreNMS rifiutato: la sessione è scaduta e il nuovo login non è riuscito. Verifica la password admin in Impostazioni → Moduli → LibreNMS",
          { status: 502, headers: TESTO },
        );
      }
      valido = nuovo;
    }
    const home = new Request(new URL(`${LIBRENMS_PROXY_BASE}/`, req.url), {
      method: "GET",
      headers: richiestaConCookieLibreNMS(req, valido).headers,
    });
    resp = await deps.inoltra(home);
    return deps.allegaCookie(resp, valido);
  }

  return deps.allegaCookie(resp, cookie);
}

export interface DipendenzeAccessoAutomaticoLibreNMS {
  accessoAutomaticoAttivo(): boolean;
  cookieAccessoAutomatico(): Promise<string | null>;
  /** Intestazioni Set-Cookie per l'interfaccia diretta (Path=/). */
  setCookieDiretti(cookie: string): string[];
  /**
   * La sessione apre ancora LibreNMS (e non la pagina di login)? Assente = non
   * si controlla (comportamento di prima).
   */
  sessioneValida?(cookie: string): Promise<boolean>;
  /** Svuota la cache delle sessioni: il prossimo login è nuovo. */
  svuotaCache?(): void;
}

export interface OpzioniAccessoAutomaticoLibreNMS {
  /** Host (senza porta) con cui il browser ha aperto DA-IPAM: dove finiscono i cookie. */
  hostRichiesta?: string | null;
  /** Host serviti da nginx dell'appliance: lì LibreNMS risponde anche col nome di DA-IPAM. */
  hostAllineabili?: string[];
}

export type AllineamentoHostLibreNMS =
  | { ok: true; url: string; cambiato: boolean }
  | { ok: false; url: string; hostDaIpam: string; hostLibreNMS: string };

/**
 * Il cookie impostato dalla risposta di DA-IPAM vale per il nome con cui il
 * browser ha aperto DA-IPAM (i cookie non guardano la porta, guardano il nome).
 * Il 302 deve quindi portare a LibreNMS sullo STESSO nome (passo 4b, 16/10):
 *  - stesso nome già → l'URL resta;
 *  - LibreNMS servito da nginx dell'appliance (uno degli `hostAllineabili`) →
 *    si cambia solo il nome nel 302, porta e percorso restano;
 *  - LibreNMS altrove → non si può: l'accesso automatico perderebbe il cookie in
 *    silenzio, e lo si dice.
 */
export function allineaHostLibreNMS(
  urlDiretto: string,
  hostRichiesta: string | null | undefined,
  hostAllineabili: string[] = [],
): AllineamentoHostLibreNMS {
  const richiesta = hostRichiesta?.trim().toLowerCase();
  let target: URL;
  try {
    target = new URL(urlDiretto);
  } catch {
    return { ok: true, url: urlDiretto, cambiato: false };
  }
  if (!richiesta) return { ok: true, url: urlDiretto, cambiato: false };
  const hostLibreNMS = target.hostname.toLowerCase();
  if (hostLibreNMS === richiesta) return { ok: true, url: urlDiretto, cambiato: false };
  const allineabili = hostAllineabili.map((h) => h.toLowerCase());
  if (allineabili.includes(hostLibreNMS)) {
    target.hostname = richiesta;
    return { ok: true, url: target.toString(), cambiato: true };
  }
  return { ok: false, url: urlDiretto, hostDaIpam: richiesta, hostLibreNMS };
}

/** Host (senza porta) dalla richiesta: `X-Forwarded-Host` di nginx, poi `Host`. */
export function hostDellaRichiesta(headers: Headers): string | null {
  const grezzo = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim() || "";
  if (!grezzo) return null;
  try {
    return new URL(`https://${grezzo}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Rotta di accesso automatico: per l'admin fa il login e rimanda all'URL
 * diretto coi cookie; per gli altri rimanda all'URL diretto e basta.
 */
export async function gestisciAccessoAutomaticoLibreNMS(
  urlDiretto: string,
  ruolo: unknown,
  deps: DipendenzeAccessoAutomaticoLibreNMS,
  opzioni: OpzioniAccessoAutomaticoLibreNMS = {},
): Promise<Response> {
  const rimanda = () => new Response(null, { status: 302, headers: { Location: urlDiretto } });
  if (!puoUsareAccessoAutomatico(ruolo) || !deps.accessoAutomaticoAttivo()) return rimanda();

  const host = allineaHostLibreNMS(urlDiretto, opzioni.hostRichiesta, opzioni.hostAllineabili);
  if (!host.ok) {
    const pagina =
      `<!doctype html><meta charset="utf-8"><title>Accesso automatico a LibreNMS</title>` +
      `<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto;line-height:1.5">` +
      `<h1 style="font-size:1.2rem">L'accesso automatico a LibreNMS non può funzionare da qui</h1>` +
      `<p>DA-IPAM è aperto come <b>${escapeHtml(host.hostDaIpam)}</b>, LibreNMS sta su <b>${escapeHtml(host.hostLibreNMS)}</b>: ` +
      `il cookie di sessione resterebbe sul primo nome e LibreNMS chiederebbe il login.</p>` +
      `<p>Apri DA-IPAM come <b>${escapeHtml(host.hostLibreNMS)}</b>, oppure entra in LibreNMS col suo login: ` +
      `<a href="${escapeHtml(urlDiretto)}">${escapeHtml(urlDiretto)}</a></p></body>`;
    return new Response(pagina, { status: 409, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  let cookie = await deps.cookieAccessoAutomatico();
  // Sessione in cache che non apre più LibreNMS (scaduta, invalidata a monte):
  // via dalla cache e un login nuovo, una volta (passo 4b, 16/10).
  if (cookie && deps.sessioneValida && !(await deps.sessioneValida(cookie))) {
    deps.svuotaCache?.();
    cookie = await deps.cookieAccessoAutomatico();
    if (cookie && !(await deps.sessioneValida(cookie))) {
      deps.svuotaCache?.();
      return new Response(
        "Accesso automatico a LibreNMS: anche dopo un login nuovo LibreNMS apre la pagina di login. Verifica la password admin in Impostazioni → Moduli → LibreNMS",
        { status: 502, headers: TESTO },
      );
    }
  }
  if (!cookie) {
    return new Response(
      "Accesso automatico a LibreNMS non disponibile: verifica la password admin in Impostazioni → Moduli → LibreNMS",
      { status: 502, headers: TESTO },
    );
  }
  const headers = new Headers({ Location: host.url });
  for (const sc of deps.setCookieDiretti(cookie)) headers.append("Set-Cookie", sc);
  return new Response(null, { status: 302, headers });
}
