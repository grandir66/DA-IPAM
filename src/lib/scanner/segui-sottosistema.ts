/**
 * Aggancia un giro che gira in un sottosistema proprio (sonde dei servizi, matrice di
 * segmentazione) al registro dei progressi delle scansioni, così la pagina `/scans` apre il
 * pannello e la bacheca «In esecuzione» lo mostra come per una Discovery.
 *
 * È solo un ponte: non tocca il motore. Legge lo stato che il sottosistema già espone
 * (`inCorso`, `fatte`, `totale`, `iniziato`, `finito`, `errore`, e la `fase` se c'è), lo rispecchia
 * nel registro con `aggiornaProgresso`, e alla fine segna «completata» o «fallita». Nessun contatore
 * inventato: i campi che il sottosistema non ha restano a zero e il pannello li nasconde.
 */
import { randomUUID } from "node:crypto";
import { registraProgresso, aggiornaProgresso } from "@/lib/scanner/discovery";

/** La parte dello stato di un sottosistema che serve al registro dei progressi. */
export interface LetturaSottosistema {
  inCorso: boolean;
  totale: number;
  fatte: number;
  iniziato: string | null;
  finito: string | null;
  errore: string | null;
  /** Fase corrente, se il sottosistema la espone; altrimenti si usa `faseDefault`. */
  fase?: string | null;
}

export interface OpzioniSegui {
  tenantCode: string;
  /** Tipo del giro per l'etichetta del pannello (`etichettaGiro`): "controlli", "segmentazione", … */
  scanType: string;
  networkId: number | null;
  etichetta?: string;
  /** Fase mostrata quando il sottosistema non ne espone una propria. */
  faseDefault: string;
  /** Traduce la fase grezza del sottosistema in testo da mostrare. */
  fase?: (lettura: LetturaSottosistema) => string;
  leggiStato: () => LetturaSottosistema;
  /** Ogni quanto rileggere lo stato (ms). */
  intervalloMs?: number;
  /** Tetto di sicurezza: oltre questo il ponte si chiude anche se il sottosistema non ha finito. */
  maxMs?: number;
}

export type SeguiSottosistema = (opzioni: OpzioniSegui) => string;

const INTERVALLO_DEFAULT_MS = 1_000;
const MAX_DEFAULT_MS = 20 * 60_000;

function testo(opzioni: OpzioniSegui, lettura: LetturaSottosistema): string {
  return opzioni.fase?.(lettura) ?? lettura.fase ?? opzioni.faseDefault;
}

/**
 * Registra un giro nel registro dei progressi e lo tiene allineato allo stato del sottosistema
 * finché non finisce. Ritorna l'id del giro (da restituire come `job_id` del lancio).
 */
export const seguiSottosistema: SeguiSottosistema = (opzioni) => {
  const id = randomUUID();
  const ora = new Date().toISOString();
  const iniziale = opzioni.leggiStato();
  registraProgresso({
    id,
    network_id: opzioni.networkId ?? 0,
    scan_type: opzioni.scanType,
    status: "running",
    total: iniziale.totale ?? 0,
    scanned: iniziale.fatte ?? 0,
    found: 0,
    phase: testo(opzioni, iniziale),
    started_at: iniziale.iniziato ?? ora,
    tenant_code: opzioni.tenantCode,
    etichetta: opzioni.etichetta,
    // Lo stop non è cablato per questi sottosistemi: niente pulsante «Ferma» nel pannello.
    fermabile: false,
    logs: [],
  });

  const scadenza = Date.now() + (opzioni.maxMs ?? MAX_DEFAULT_MS);
  const timer = setInterval(() => {
    const s = opzioni.leggiStato();
    const scaduto = Date.now() > scadenza;
    if (!s.inCorso || scaduto) {
      clearInterval(timer);
      const errore = s.errore ?? (scaduto ? "Il giro non ha risposto in tempo" : null);
      aggiornaProgresso(id, {
        status: errore ? "failed" : "completed",
        total: s.totale ?? 0,
        scanned: s.fatte ?? 0,
        phase: errore ? "Errore" : "Completato",
        ...(errore ? { error: errore } : {}),
      });
      return;
    }
    aggiornaProgresso(id, {
      total: s.totale ?? 0,
      scanned: s.fatte ?? 0,
      phase: testo(opzioni, s),
    });
  }, opzioni.intervalloMs ?? INTERVALLO_DEFAULT_MS);
  // Il ponte non deve tenere vivo il processo da solo.
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

  return id;
};
