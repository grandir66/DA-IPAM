/**
 * A-IPAM, Task 3: il corpo AD Health per l'hub DA-Vul-can (`POST /api/ipam/ad-health`).
 *
 * Involucro sottile di `toHubExport()` (lo stesso export del download a mano, che
 * resta il ripiego): in più `run_id`, `integrazione` e `codcli` di controllo.
 * `integrazione` è l'alias `ad-<id>`: mai `ad_integrations.name` né `dc_host`.
 * `generated_at` è la fine del run, così lo stesso run dà sempre gli stessi byte e
 * l'hub riconosce il doppione per sha256 (un ritentativo non crea un report nuovo).
 * Funzione pura.
 */
import { toHubExport } from "@/lib/ad/health/export";
import type { AdHealthRunRow } from "@/lib/ad/health/persist";
import type { HealthFinding, HealthScore } from "@/lib/ad/health/types";
import { parseDbDate } from "@/lib/db-date";

/** Limite dell'hub (`MAX_AD_HEALTH_FINDINGS`, oltre risponde 413): oltre non si invia. */
export const MAX_REGOLE_AD = 5000;

function punteggio(run: AdHealthRunRow): HealthScore | null {
  if (run.scoreGlobal == null) return null;
  return {
    global: run.scoreGlobal,
    stale: run.scoreStale ?? 0,
    privileged: run.scorePrivileged ?? 0,
    trust: run.scoreTrust ?? 0,
    anomaly: run.scoreAnomaly ?? 0,
  };
}

export function corpoAdHealth(a: {
  run: AdHealthRunRow;
  findings: HealthFinding[];
  integrazioneId: number;
  domainFqdn: string;
  codcli: string;
}): { json: string; regole: number } | { errore: string } {
  if (!a.run.finishedAt) return { errore: "esecuzione senza ora di fine" };
  const fine = parseDbDate(a.run.finishedAt);
  if (Number.isNaN(fine.getTime())) return { errore: "ora di fine dell'esecuzione illeggibile" };
  const score = punteggio(a.run);
  if (!score) return { errore: "esecuzione senza punteggio" };
  if (a.findings.length > MAX_REGOLE_AD) {
    return { errore: `oltre 5.000 regole (${a.findings.length}): l'hub non lo accetta` };
  }
  const corpo = {
    ...toHubExport({ domainFqdn: a.domainFqdn, score, findings: a.findings, generatedAt: fine }),
    run_id: a.run.id,
    integrazione: `ad-${a.integrazioneId}`,
    codcli: a.codcli,
  };
  return { json: JSON.stringify(corpo), regole: a.findings.length };
}
