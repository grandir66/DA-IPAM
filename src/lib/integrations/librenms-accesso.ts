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
}

const TESTO = { "content-type": "text/plain; charset=utf-8" };

/** Gestore del reverse proxy, dopo che la rotta ha verificato la sessione. */
export async function gestisciProxyLibreNMS(
  req: Request,
  ruolo: unknown,
  deps: DipendenzeProxyLibreNMS,
): Promise<Response> {
  if (!puoUsareAccessoAutomatico(ruolo)) {
    // Senza cookie di LibreNMS: una sessione nata da un accesso automatico
    // precedente (o di un altro utente sullo stesso browser) non passa.
    return deps.inoltra(richiestaConCookieLibreNMS(req, ""));
  }
  // Admin con l'accesso automatico spento: come prima, la richiesta così com'è.
  if (!deps.accessoAutomaticoAttivo()) return deps.inoltra(req);

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
  const percorso = new URL(req.url).pathname;
  if (percorso.endsWith("/login") || resp.headers.get("location")?.includes("/login")) {
    const home = new Request(new URL(`${LIBRENMS_PROXY_BASE}/`, req.url), {
      method: "GET",
      headers: inoltrata.headers,
    });
    resp = await deps.inoltra(home);
  }

  return deps.allegaCookie(resp, cookie);
}

export interface DipendenzeAccessoAutomaticoLibreNMS {
  accessoAutomaticoAttivo(): boolean;
  cookieAccessoAutomatico(): Promise<string | null>;
  /** Intestazioni Set-Cookie per l'interfaccia diretta (Path=/). */
  setCookieDiretti(cookie: string): string[];
}

/**
 * Rotta di accesso automatico: per l'admin fa il login e rimanda all'URL
 * diretto coi cookie; per gli altri rimanda all'URL diretto e basta.
 */
export async function gestisciAccessoAutomaticoLibreNMS(
  urlDiretto: string,
  ruolo: unknown,
  deps: DipendenzeAccessoAutomaticoLibreNMS,
): Promise<Response> {
  const rimanda = () => new Response(null, { status: 302, headers: { Location: urlDiretto } });
  if (!puoUsareAccessoAutomatico(ruolo) || !deps.accessoAutomaticoAttivo()) return rimanda();

  const cookie = await deps.cookieAccessoAutomatico();
  if (!cookie) {
    return new Response(
      "Accesso automatico a LibreNMS non disponibile: verifica la password admin in Impostazioni → Moduli → LibreNMS",
      { status: 502, headers: TESTO },
    );
  }
  const headers = new Headers({ Location: urlDiretto });
  for (const sc of deps.setCookieDiretti(cookie)) headers.append("Set-Cookie", sc);
  return new Response(null, { status: 302, headers });
}
