import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/db-tenant";
import { attendiRilascio, isScanInCorso } from "./network-scan-lock";
import { aggiornaProgresso, dimenticaGiro, getScanProgress, registraProgresso, segnaGiroInArresto, type AvvioDiscovery } from "./discovery";
import { conSegnaleGiro, fermaGiro, registraGiroFermabile, TESTO_GIRO_FERMATO } from "./ferma-giro";
import type { ScanProgress } from "@/types";

/** Una fase: `avvia` fa partire il suo giro e lo lega alla sequenza. */
export interface FaseSequenza {
  nome: string;
  avvia: (sequenzaId: string) => Promise<AvvioDiscovery>;
}

export interface DatiSequenza {
  tenantCode: string;
  networkId: number;
  etichetta: string;
  /** `sequenza_scoperta`, `sequenza_avanzata`, `sequenza_accesso`: il nome si legge da `etichettaGiro`. */
  tipo: string;
  fasi: FaseSequenza[];
}

/** Quanto una fase aspetta la rete occupata da un altro giro infilato fra due fasi. */
const ATTESA_RETE_MS = 30 * 60_000;
const COPIA_MS = 1_000;

/** Aspetta che la rete si liberi o che arrivi lo stop, senza lasciare ascoltatori sul segnale. */
async function reteLiberaOStop(rilascio: Promise<void>, segnale: AbortSignal): Promise<void> {
  let togli = () => {};
  const stop = new Promise<void>((resolve) => {
    if (segnale.aborted) return resolve();
    const fine = () => resolve();
    segnale.addEventListener("abort", fine, { once: true });
    togli = () => segnale.removeEventListener("abort", fine);
  });
  await Promise.race([rilascio, stop]);
  togli();
}

/**
 * Parte una fase. Fra due fasi può infilarsi un job sulla stessa rete: si aspetta che finisca, fino
 * al limite, e lo stop interrompe l'attesa. Ritorna `null` se la sequenza è stata fermata intanto.
 */
async function avviaFase(fase: FaseSequenza, dati: DatiSequenza, id: string, segnale: AbortSignal): Promise<AvvioDiscovery | null> {
  const scadenza = Date.now() + ATTESA_RETE_MS;
  for (;;) {
    if (segnale.aborted) return null;
    try {
      return await fase.avvia(id);
    } catch (e) {
      if (!isScanInCorso(e) || Date.now() >= scadenza) throw e;
      const rilascio = attendiRilascio(dati.tenantCode, dati.networkId);
      if (rilascio) await reteLiberaOStop(rilascio, segnale);
    }
  }
}

/** Segue una fase fino alla chiusura, copiando sulla sequenza quello che fa. */
async function seguiFase(id: string, numero: number, dati: DatiSequenza, avvio: AvvioDiscovery, segnale: AbortSignal) {
  const nome = dati.fasi[numero - 1].nome;
  const righePrecedenti = getScanProgress(id)?.logs ?? [];
  const copia = () => {
    const f = getScanProgress(avvio.id);
    if (!f) return;
    aggiornaProgresso(id, {
      phase: `Fase ${numero}/${dati.fasi.length} · ${nome}: ${f.phase}`,
      scanned: f.scanned,
      total: f.total,
      found: f.found,
      // Le righe delle fasi finite restano: chi legge una fase fallita vede anche quelle prima.
      logs: [...righePrecedenti, ...(f.logs ?? [])],
    });
  };
  const ferma = () => {
    fermaGiro(avvio.id);
    segnaGiroInArresto(avvio.id);
  };
  if (segnale.aborted) ferma();
  else segnale.addEventListener("abort", ferma, { once: true });
  copia();
  const timer = setInterval(copia, COPIA_MS);
  timer.unref?.();
  try {
    return await avvio.done;
  } finally {
    clearInterval(timer);
    segnale.removeEventListener("abort", ferma);
    copia();
  }
}

/**
 * Le fasi una dopo l'altra sul server: chiudere la pagina non ferma più le fasi successive, come
 * succedeva quando la sequenza la guidava il browser. La prima fase parte prima di rispondere, così una
 * rete occupata torna subito al chiamante come errore (`ScanInCorsoError`) e non nasce nessuna sequenza.
 */
export async function avviaSequenza(dati: DatiSequenza): Promise<{ id: string; progress: ScanProgress }> {
  const id = `seq-${randomUUID()}`;
  const prima = await dati.fasi[0].avvia(id);

  const progress: ScanProgress = {
    id,
    network_id: dati.networkId,
    scan_type: dati.tipo,
    status: "running",
    total: prima.progress.total,
    scanned: 0,
    found: 0,
    phase: `Fase 1/${dati.fasi.length} · ${dati.fasi[0].nome}`,
    started_at: new Date().toISOString(),
    logs: [],
    tenant_code: dati.tenantCode,
    etichetta: dati.etichetta,
    link: `/networks/${dati.networkId}`,
    fermabile: true,
  };
  registraProgresso(progress);
  const { segnale, libera } = registraGiroFermabile(id);

  const giro = async () => {
    const chiudi = (patch: Partial<ScanProgress>) => aggiornaProgresso(id, patch);
    try {
      let avvio: AvvioDiscovery | null = prima;
      for (let n = 1; n <= dati.fasi.length; n++) {
        if (n > 1) {
          avvio = await avviaFase(dati.fasi[n - 1], dati, id, segnale);
          if (!avvio) {
            chiudi({ status: "failed", fermato: true, phase: TESTO_GIRO_FERMATO, error: TESTO_GIRO_FERMATO });
            return;
          }
        }
        const esito = await seguiFase(id, n, dati, avvio!, segnale);
        if (esito.fermato) {
          chiudi({ status: "failed", fermato: true, phase: TESTO_GIRO_FERMATO, error: TESTO_GIRO_FERMATO });
          return;
        }
        if (esito.status === "failed") {
          const seguono = n < dati.fasi.length ? ": le successive non sono partite" : "";
          chiudi({
            status: "failed",
            phase: `Fase ${n}/${dati.fasi.length} · ${dati.fasi[n - 1].nome}: fallita`,
            error: `${dati.fasi[n - 1].nome}: ${esito.error ?? "errore sconosciuto"}${seguono}`,
          });
          return;
        }
      }
      chiudi({ status: "completed", phase: `Completata: ${dati.fasi.map((f) => f.nome).join(" + ")}` });
    } catch (e) {
      chiudi({ status: "failed", phase: "Sequenza fallita", error: e instanceof Error ? e.message : "errore sconosciuto" });
    } finally {
      libera();
      dimenticaGiro(id);
    }
  };

  // Come `discoverNetwork`: il giro riparte dentro il contesto del tenant e non si attende.
  void withTenant(dati.tenantCode, () => conSegnaleGiro(segnale, giro));
  return { id, progress };
}
