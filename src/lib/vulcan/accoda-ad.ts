/**
 * A-IPAM, Task 3: a fine esecuzione AD Health riuscita l'export entra nella coda
 * verso DA-Vul-can — il passo che oggi fa una persona caricando il `.json`.
 *
 * Solo se il flusso è acceso (`VULCAN_TOKEN` in `oggetto.env`, riletto a ogni uso):
 * spento = nessuna scrittura. Solo se il tenant corrente è quello dell'invio
 * (`tenantPerVulcan`): su un hub DA-IPAM multi-tenant gli altri clienti non escono
 * (caso 2 del piano). Mai un'eccezione verso il motore: l'esecuzione AD resta `ok`
 * e un guasto qui è una riga `[vulcan]` (senza dominio, nome o gettone).
 */
import type { Database } from "better-sqlite3";
import { getFindings, getRunById } from "@/lib/ad/health/persist";
import type { HealthFinding } from "@/lib/ad/health/types";
import { getAdIntegrationById } from "@/lib/db";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { accoda } from "./coda";
import { corpoAdHealth } from "./corpo-ad";
import { leggiConfigVulcan, tenantPerVulcan, type ConfigVulcan } from "./config";

export type EsitoAccodaAd = "accodato" | "doppione" | "spento" | "altro_cliente" | "errore";

/** Dipendenze sostituibili nelle prove; in esercizio valgono quelle vere. */
export interface DipAccodaAd {
  config?: () => ConfigVulcan;
  tenantCorrente?: () => string | null;
  tenantInvio?: (codcli: string) => string | null;
  findings?: (db: Database, runId: number) => HealthFinding[];
  integrazione?: (id: number) => { domain: string } | undefined;
}

export function accodaAdHealthSeAcceso(db: Database, runId: number, dip: DipAccodaAd = {}): EsitoAccodaAd {
  try {
    const config = (dip.config ?? leggiConfigVulcan)();
    if (config.stato !== "pronta") return "spento";

    const corrente = (dip.tenantCorrente ?? getCurrentTenantCode)();
    const invio = (dip.tenantInvio ?? tenantPerVulcan)(config.codcli);
    if (!corrente || !invio || corrente !== invio) return "altro_cliente";

    const run = getRunById(db, runId);
    if (!run) throw new Error("esecuzione non trovata");
    if (run.status !== "ok") throw new Error(`esecuzione in stato ${run.status}`);
    const integrazione = (dip.integrazione ?? getAdIntegrationById)(run.integrationId);
    if (!integrazione) throw new Error("integrazione AD non trovata");
    const findings = (dip.findings ?? getFindings)(db, run.id);

    const corpo = corpoAdHealth({
      run,
      findings,
      integrazioneId: run.integrationId,
      domainFqdn: integrazione.domain,
      codcli: config.codcli,
    });
    if ("errore" in corpo) throw new Error(corpo.errore);

    const r = accoda(db, { tipo: "ad-health", rif: String(run.id), json: corpo.json, oggetti: corpo.regole });
    return r.nuovo ? "accodato" : "doppione";
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(`[vulcan] AD Health run=${runId} non accodato: ${motivo}`);
    return "errore";
  }
}
