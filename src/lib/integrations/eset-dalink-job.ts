/**
 * Il timer della lettura dei dati ESET da DA-Link (17/11/2026), nella forma del segnale
 * (`dalink/segnale-job.ts`): un giro ogni 6 ore, il primo tre minuti dopo l'avvio.
 *
 * Senza `/etc/dalink/oggetto.env`, o con l'interruttore `eset.da_dalink` spento per il cliente
 * (di serie lo è), il giro si ferma prima di qualunque rete. In DA-Link il software si legge una
 * volta al giorno e le macchine ogni ora: sei ore bastano.
 */
import { leggiConfigDalink } from "../dalink/config";
import { dipendenzeFattiReali, CLIENTE_APPLIANCE } from "../dalink/fatti";
import { richiestaDalink } from "../dalink/trasporto";
import { getTenantDb } from "../db-tenant";
import { giroEset, MAX_RISPOSTA_ESET, PERCORSO_ESET, type EsitoGiroEset } from "./eset-dalink";
import { riabbinaEset } from "./eset-abbina";

export const OGNI_MS = 6 * 60 * 60_000;
export const PRIMO_MS = 3 * 60_000;

/** Il cliente dell'istanza, come lo sceglie il segnale: il codice di DA-Link se c'è, altrimenti l'appliance a cliente singolo. */
export function clienteDellIstanza(codcli: string): string | null {
  try {
    if (dipendenzeFattiReali.clienteEsiste(codcli)) return codcli;
    if (dipendenzeFattiReali.unicoClienteAppliance()) return CLIENTE_APPLIANCE;
  } catch {
    return null;
  }
  return null;
}

export async function giroEsetReale(): Promise<EsitoGiroEset> {
  const cfg = leggiConfigDalink();
  if (cfg.stato !== "pronta") return { esito: "non_configurato", dettaglio: "nessuna configurazione DA-Link valida su questa istanza" };
  const cliente = clienteDellIstanza(cfg.codcli);
  if (!cliente) return { esito: "non_configurato", dettaglio: "il cliente di DA-Link non è fra quelli di questa istanza" };
  return giroEset({
    db: getTenantDb(cliente),
    codcli: cfg.codcli,
    chiedi: () =>
      richiestaDalink(new URL(PERCORSO_ESET, cfg.url), cfg.impronta, "GET", { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" }, undefined, {
        timeoutMs: 120_000,
        maxRisposta: MAX_RISPOSTA_ESET,
      }),
    dopo: (db) => {
      riabbinaEset(db);
    },
  });
}

interface StatoTimer { inCorso: Promise<EsitoGiroEset> | null; stop: (() => void) | null }
const CHIAVE = Symbol.for("da-ipam.eset.dalink-job");
function stato(): StatoTimer {
  const g = globalThis as unknown as Record<symbol, StatoTimer | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = { inCorso: null, stop: null };
    g[CHIAVE] = s;
  }
  return s;
}

/** Mai due giri insieme: il timer e «Leggi adesso» passano di qui. */
export function leggiEsetAdesso(giro: () => Promise<EsitoGiroEset> = giroEsetReale): Promise<EsitoGiroEset> {
  const s = stato();
  if (s.inCorso) return s.inCorso;
  const p = (async () => giro())().finally(() => {
    if (stato().inCorso === p) stato().inCorso = null;
  });
  s.inCorso = p;
  return p;
}

export function avviaLetturaEset(opz: { primoMs?: number; ogniMs?: number; giro?: () => Promise<EsitoGiroEset> } = {}): () => void {
  const s = stato();
  if (s.stop) return s.stop;
  const tic = () => {
    leggiEsetAdesso(opz.giro ?? giroEsetReale)
      .then((e) => {
        if (e.esito === "ok") console.log(`[eset] da DA-Link: ${e.macchine} macchine, ${e.vulnerabilita} vulnerabilità, ${e.software} righe di software`);
        else if (e.esito === "errore") console.error(`[eset] da DA-Link: ${e.dettaglio}`);
      })
      .catch((e: unknown) => console.error("[eset] giro fallito:", e instanceof Error ? e.message : "errore imprevisto"));
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
