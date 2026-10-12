/**
 * `fetch` di un JSON che non confonde un errore con "nessun dato".
 *
 * Difetto UI-7 (analisi 2026-10-12): diverse pagine trasformavano un 401/409/500
 * o un server irraggiungibile in una lista vuota ("Nessuna scansione eseguita")
 * o lasciavano a schermo i dati vecchi senza dire niente. Qui l'esito è
 * esplicito: i dati, oppure un messaggio leggibile da mostrare con `LoadError`.
 * Una richiesta annullata (AbortController) rilancia l'AbortError, così il
 * chiamante la ignora invece di mostrarla come errore.
 */
export type FetchJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    return { ok: false, status: null, message: "Server non raggiungibile" };
  }
  // NextAuth non risponde 401 alle /api con la sessione scaduta: rimanda a /login
  // e fetch segue il rinvio, quindi arriva la pagina di login con 200.
  if (res.redirected && isLoginUrl(res.url)) {
    return { ok: false, status: 401, message: SESSIONE_SCADUTA };
  }
  let body: unknown = null;
  let isJson = false;
  if (res.status !== 204) {
    try {
      body = await res.json();
      isJson = true;
    } catch {
      /* corpo assente o non JSON */
    }
  }
  if (!res.ok) return { ok: false, status: res.status, message: errorMessage(res.status, body) };
  if (res.status !== 204 && !isJson) {
    return { ok: false, status: res.status, message: "Risposta non valida dal server" };
  }
  return { ok: true, data: body as T };
}

const SESSIONE_SCADUTA = "Sessione scaduta: rientra con le tue credenziali";

function isLoginUrl(url: string): boolean {
  try {
    return /^\/login(\/|$)/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function errorMessage(status: number, body: unknown): string {
  const dalServer =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  if (status === 401) return SESSIONE_SCADUTA;
  if (dalServer) return dalServer;
  if (status === 403) return "Non hai i permessi per vedere questi dati";
  return `Errore del server (HTTP ${status})`;
}
