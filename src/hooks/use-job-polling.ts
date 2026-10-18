"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallJob } from "@/lib/integrations/types";
import { interrogaJob, type PassoPolling } from "@/lib/integrations/polling-job";

/**
 * Segue un job d'installazione finché non c'è un esito, con la logica di
 * `polling-job.ts`. Un giro parte solo quando il precedente ha risposto (niente
 * richieste sovrapposte) e tutto si ferma all'uscita dalla pagina.
 *
 * `avviso` è il messaggio da mostrare accanto al log: errori temporanei mentre
 * si riprova, oppure il perché il controllo si è fermato senza esito.
 * `onFine` riceve l'ultimo passo (finito, sessione scaduta, esito sconosciuto,
 * troppi errori).
 */
export function useJobPolling(onFine: (passo: PassoPolling) => void, intervalloMs = 1500) {
  const [job, setJob] = useState<InstallJob | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [attivo, setAttivo] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ogni avvio/fermo cambia generazione: la risposta di un giro vecchio si scarta.
  const generazioneRef = useRef(0);
  const onFineRef = useRef(onFine);

  useEffect(() => {
    onFineRef.current = onFine;
  }, [onFine]);

  const ferma = useCallback(() => {
    generazioneRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => ferma, [ferma]);

  const avvia = useCallback(
    (jobId: string) => {
      ferma();
      const generazione = generazioneRef.current;
      let errori = 0;
      setJob(null);
      setAvviso(null);
      setAttivo(true);
      const giro = async () => {
        const passo = await interrogaJob(jobId, errori);
        if (generazione !== generazioneRef.current) return;
        errori = passo.errori;
        if (passo.job) setJob(passo.job);
        setAvviso(passo.messaggio);
        if (passo.continua) {
          timerRef.current = setTimeout(giro, intervalloMs);
        } else {
          timerRef.current = null;
          setAttivo(false);
          onFineRef.current(passo);
        }
      };
      timerRef.current = setTimeout(giro, intervalloMs);
    },
    [ferma, intervalloMs],
  );

  return { job, avviso, attivo, avvia };
}
