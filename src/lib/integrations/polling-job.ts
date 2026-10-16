/**
 * Polling dell'avanzamento di un'installazione (job di `job-store.ts`), senza React.
 *
 * Passo 2 del piano di solidità (2026-10-16). Prima le card dei moduli facevano
 * `if (!res.ok) return` dentro un setInterval: con la sessione scaduta, col
 * servizio riavviato (il job vive in memoria e sparisce: 404) o con la rete giù
 * la rotellina girava per sempre senza dire niente. Qui ogni risposta diventa un
 * passo con l'esito, il messaggio da mostrare e se continuare: nessun polling
 * resta acceso senza una spiegazione a schermo.
 */
import { fetchJson, type FetchJsonResult } from "@/lib/fetch-json";
import type { InstallJob } from "./types";

/** Errori consecutivi (rete giù, 5xx, risposta strana) prima di fermarsi. */
export const MAX_ERRORI_CONSECUTIVI = 5;

export type EsitoPolling =
  /** Il job sta lavorando: si continua. */
  | "in_corso"
  /** Il job è arrivato a `done` o `error`: ci si ferma, l'esito è nel job. */
  | "finito"
  /** 401 (o rinvio al login): ci si ferma. */
  | "sessione_scaduta"
  /** 404: il job non c'è più, di solito perché il servizio è ripartito. Ci si ferma. */
  | "esito_sconosciuto"
  /** Un errore, ma sotto la soglia: si riprova, col messaggio a schermo. */
  | "errore_temporaneo"
  /** Troppi errori di fila: ci si ferma. */
  | "errore_ripetuto";

export interface PassoPolling {
  esito: EsitoPolling;
  /** true = programmare un altro giro. */
  continua: boolean;
  /** Errori consecutivi dopo questo passo (0 dopo una risposta buona). */
  errori: number;
  /** Il job letto, se la risposta era buona. */
  job: InstallJob | null;
  /** Da mostrare accanto al log; null quando non c'è niente da spiegare. */
  messaggio: string | null;
}

export const MSG_SESSIONE_SCADUTA =
  "Sessione scaduta: il controllo dell'avanzamento si è fermato. Rientra e ricarica la pagina per vedere com'è andata.";

export const MSG_ESITO_SCONOSCIUTO =
  "Esito sconosciuto: il servizio è stato riavviato e l'installazione non è più seguita. Controlla lo stato del modulo prima di riprovare.";

function sembraUnJob(x: unknown): x is InstallJob {
  if (!x || typeof x !== "object") return false;
  const j = x as { phase?: unknown; log?: unknown };
  return typeof j.phase === "string" && Array.isArray(j.log);
}

/** Decide il passo da una risposta già letta. Pura: si prova senza rete. */
export function valutaRisposta(
  risposta: FetchJsonResult<unknown>,
  erroriPrima: number,
  maxErrori: number = MAX_ERRORI_CONSECUTIVI,
): PassoPolling {
  if (risposta.ok) {
    if (sembraUnJob(risposta.data)) {
      const job = risposta.data;
      const finito = job.phase === "done" || job.phase === "error";
      return { esito: finito ? "finito" : "in_corso", continua: !finito, errori: 0, job, messaggio: null };
    }
    return errore("Risposta non valida dal server", erroriPrima, maxErrori);
  }
  if (risposta.status === 401) {
    return { esito: "sessione_scaduta", continua: false, errori: 0, job: null, messaggio: MSG_SESSIONE_SCADUTA };
  }
  if (risposta.status === 404) {
    return { esito: "esito_sconosciuto", continua: false, errori: 0, job: null, messaggio: MSG_ESITO_SCONOSCIUTO };
  }
  return errore(risposta.message, erroriPrima, maxErrori);
}

function errore(dettaglio: string, erroriPrima: number, maxErrori: number): PassoPolling {
  const errori = erroriPrima + 1;
  if (errori >= maxErrori) {
    return {
      esito: "errore_ripetuto",
      continua: false,
      errori,
      job: null,
      messaggio: `Avanzamento non leggibile dopo ${errori} tentativi (ultimo errore: ${dettaglio}). Il controllo si è fermato: ricarica la pagina per vedere lo stato.`,
    };
  }
  return {
    esito: "errore_temporaneo",
    continua: true,
    errori,
    job: null,
    messaggio: `Avanzamento non leggibile (tentativo ${errori} di ${maxErrori}): ${dettaglio}. Riprovo…`,
  };
}

/** Un giro di polling: legge `/api/integrations/install-progress/<jobId>` e decide. */
export async function interrogaJob(
  jobId: string,
  erroriPrima: number,
  maxErrori: number = MAX_ERRORI_CONSECUTIVI,
): Promise<PassoPolling> {
  let risposta: FetchJsonResult<unknown>;
  try {
    risposta = await fetchJson<unknown>(`/api/integrations/install-progress/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
  } catch {
    // fetchJson rilancia solo l'AbortError, che qui non si usa: lo si conta come rete giù.
    risposta = { ok: false, status: null, message: "Server non raggiungibile" };
  }
  return valutaRisposta(risposta, erroriPrima, maxErrori);
}
