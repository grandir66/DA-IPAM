/**
 * Il timer del segnale di vita verso DA-Link (tappa C1).
 *
 * Ogni 5 minuti (come l'heartbeat dell'edge), il primo un minuto dopo l'avvio. Senza
 * `/etc/dalink/oggetto.env` ogni giro si ferma prima di qualunque rete (vedi
 * `invio.ts`): il timer gira, ma un'istanza senza DA-Link non chiama nessuno. Il file
 * si rilegge a ogni giro, così chi lo crea dopo l'installazione non deve riavviare.
 *
 * Mai due giri insieme: timer, «Invia adesso» e cambio di livello passano tutti da
 * `inviaAdesso`, che fa aspettare il secondo. Lo stato sta su globalThis perché le
 * rotte di Next e server.ts (tsx) caricano istanze diverse di questo modulo.
 */
import { giroSegnale, type EsitoGiro } from "./invio";

export const OGNI_MS = 5 * 60_000;
export const PRIMO_MS = 60_000;

interface StatoTimer {
  inCorso: Promise<EsitoGiro> | null;
  stop: (() => void) | null;
}

const CHIAVE = Symbol.for("da-ipam.dalink.segnale-job");
function stato(): StatoTimer {
  const g = globalThis as unknown as Record<symbol, StatoTimer | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = { inCorso: null, stop: null };
    g[CHIAVE] = s;
  }
  return s;
}

export function inviaAdesso(giro: () => Promise<EsitoGiro> = () => giroSegnale()): Promise<EsitoGiro> {
  const s = stato();
  if (s.inCorso) return s.inCorso;
  // Funzione async: il giro parte subito, e un'eccezione diventa un rifiuto.
  const p = (async () => giro())().finally(() => {
      if (stato().inCorso === p) stato().inCorso = null;
    });
  s.inCorso = p;
  return p;
}

export function avviaSegnaleDalink(
  opz: { primoMs?: number; ogniMs?: number; giro?: () => Promise<EsitoGiro> } = {},
): () => void {
  const s = stato();
  if (s.stop) return s.stop;
  const giro = opz.giro ?? (() => giroSegnale());
  const tic = () => {
    inviaAdesso(giro).catch((e: unknown) => {
      console.error("[dalink] giro del segnale fallito:", e instanceof Error ? e.message : "errore imprevisto");
    });
  };
  const primo = setTimeout(tic, opz.primoMs ?? PRIMO_MS);
  const ogni = setInterval(tic, opz.ogniMs ?? OGNI_MS);
  primo.unref?.();
  ogni.unref?.();
  const stop = () => {
    clearTimeout(primo);
    clearInterval(ogni);
    if (stato().stop === stop) stato().stop = null;
  };
  s.stop = stop;
  return stop;
}
