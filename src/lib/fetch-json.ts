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
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* corpo assente o non JSON */
  }
  if (!res.ok) return { ok: false, status: res.status, message: errorMessage(res.status, body) };
  return { ok: true, data: body as T };
}

function errorMessage(status: number, body: unknown): string {
  const dalServer =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  if (status === 401) return "Sessione scaduta: rientra con le tue credenziali";
  if (dalServer) return dalServer;
  if (status === 403) return "Non hai i permessi per vedere questi dati";
  return `Errore del server (HTTP ${status})`;
}
