/**
 * Riconosce una pagina di login dal CONTENUTO della risposta, non dai cookie
 * (passo 4b del piano di solidità, 16/10/2026).
 *
 * Laravel (LibreNMS) dà il cookie `laravel_session` anche quando la password è
 * sbagliata: la presenza del cookie non dice niente. Dice qualcosa dove porta la
 * risposta (un rinvio a `/login`) o cosa contiene (un campo password).
 *
 * Parte pura, senza I/O: la usano la sessione web di LibreNMS e la verifica
 * «apertura per il browser» dei moduli. Client-safe.
 */

/** Vero se il percorso di un URL (assoluto o relativo) è una pagina di login. */
export function percorsoDiLogin(location: string | null | undefined): boolean {
  if (!location?.trim()) return false;
  let percorso: string;
  try {
    percorso = new URL(location.trim(), "http://x").pathname;
  } catch {
    return false;
  }
  return /\/(login|signin|sign-in)\/?$/i.test(percorso);
}

/** Vero se l'HTML contiene un modulo di login (campo password o form verso /login). */
export function htmlConLogin(body: string | null | undefined): boolean {
  if (!body) return false;
  return (
    /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(body) ||
    /<form\b[^>]*\baction\s*=\s*["'][^"']*\/(login|signin)\b/i.test(body)
  );
}

export interface RispostaDaGiudicare {
  status: number;
  location?: string | null;
  body?: string | null;
}

/** Vero se la risposta è una pagina di login o rimanda a una pagina di login. */
export function sembraPaginaDiLogin(r: RispostaDaGiudicare): boolean {
  if (r.status >= 300 && r.status < 400) return percorsoDiLogin(r.location);
  if (r.status >= 200 && r.status < 300) return htmlConLogin(r.body);
  return false;
}
