/**
 * Orchestratore probe passivi di attribuzione (fase 3 §4.5, Task 4): gating a
 * cascata, budget/concorrenza limitati, una sola `recordEvidence` per host.
 *
 * Gating (in quest'ordine, "OR" che blocca — se un livello blocca, ZERO
 * pacchetti in uscita per la rete):
 *  1. Setting globale hub `attribution_probes_enabled`: disabilitato SOLO se
 *     vale esattamente "0" o "false" (default: abilitato, incluso quando il
 *     setting non è mai stato scritto → `getSetting` ritorna `null`).
 *  2. Override per rete `networks.probes_enabled` (colonna, default 1).
 *  3. Solo host con `openPorts.length > 0` (spec §10: mai probe su IP silenti;
 *     mDNS/SSDP/WSD sono comunque tentati su questi host anche se le loro
 *     porte UDP non compaiono nel port scan TCP — vedi `probeHost`).
 *
 * Se la lettura del gate stesso fallisce (setting o rete illeggibili), si
 * fallisce CHIUSO (nessun probe) piuttosto che aperto: un errore di lettura
 * non deve tradursi in traffico di rete non autorizzato.
 *
 * Budget: default 60s totali per rete, concorrenza max 8 host in parallelo
 * (pool semplice, nessuna dipendenza nuova). Allo scadere del budget i worker
 * smettono di reclamare nuovi host (quelli già in corso completano, cappati
 * dal timeout per-probe di 2s) e si logga con `console.warn` quanti host sono
 * rimasti fuori — mai troncamento silenzioso.
 *
 * Nessun errore di rete/parsing di un singolo probe o host deve interrompere
 * l'intero run: try/catch ad ogni livello, `console.error` e avanti.
 */
import { getSetting, getNetworkById } from "@/lib/db";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { recordEvidence as recordEvidenceRaw } from "@/lib/attribution/evidence";
import { recomputeAttributionSafe } from "@/lib/attribution/recompute";
import {
  evidenceFromHttpTls,
  evidenceFromSmb2,
  evidenceFromMdns,
  evidenceFromSsdp,
  evidenceFromWsd,
} from "@/lib/attribution/probe-evidence";
import type { EvidenceInput } from "@/lib/attribution/types";
import { probeHttpTls } from "./http-tls";
import { probeSmb2 } from "./smb2";
import { probeMdns } from "./mdns";
import { probeSsdp } from "./ssdp";
import { probeWsd } from "./wsd";

export interface ProbeRunResult {
  hostsProbed: number;
  evidenceWritten: number;
  skipped: number;
  elapsedMs: number;
}

export interface ProbeHostInput {
  id: number;
  ip: string;
  openPorts: number[];
}

/** Porte web note su cui ha senso tentare HTTP/TLS (spec §4.5 Task 1, stesso elenco di http-tls.ts). */
const WEB_PORTS = new Set([80, 443, 8080, 8443, 9443, 7080, 8006, 5000, 5001, 631, 9100, 8000, 8081]);
const SMB_PORT = 445;

const DEFAULT_BUDGET_MS = 60_000;
const DEFAULT_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 2000;

/** Dipendenze iniettabili per test (nessun socket): default = probe/DB reali. */
export interface ProbeRunDeps {
  httpTls: typeof probeHttpTls;
  smb2: typeof probeSmb2;
  mdns: typeof probeMdns;
  ssdp: typeof probeSsdp;
  wsd: typeof probeWsd;
  getSetting: (key: string) => string | null;
  getNetworkById: (id: number) => { probes_enabled?: number | null } | undefined;
  /** Scrive le evidenze per l'host e ritorna quante righe sono state inserite/aggiornate. */
  recordEvidence: (hostId: number, inputs: EvidenceInput[]) => number;
  recomputeAttributionSafe: (hostId: number, trigger: "scan") => void;
}

function realRecordEvidence(hostId: number, inputs: EvidenceInput[]): number {
  const code = getCurrentTenantCode();
  if (!code) return 0;
  const dbh = getTenantDb(code);
  const res = recordEvidenceRaw(dbh, hostId, inputs);
  return res.inserted + res.refreshed;
}

const REAL_DEPS: ProbeRunDeps = {
  httpTls: probeHttpTls,
  smb2: probeSmb2,
  mdns: probeMdns,
  ssdp: probeSsdp,
  wsd: probeWsd,
  getSetting,
  getNetworkById,
  recordEvidence: realRecordEvidence,
  recomputeAttributionSafe,
};

function isProbesDisabledGlobally(deps: ProbeRunDeps): boolean {
  const v = deps.getSetting("attribution_probes_enabled");
  return v === "0" || v === "false";
}

function isProbesDisabledForNetwork(deps: ProbeRunDeps, networkId: number): boolean {
  const network = deps.getNetworkById(networkId);
  if (!network) return false; // rete non trovata: non è questo il gate che deve bloccare
  return Number(network.probes_enabled) === 0;
}

/** Esegue i probe applicabili a un host e ne scrive le evidenze in una sola `recordEvidence`. */
async function probeHost(host: ProbeHostInput, deps: ProbeRunDeps): Promise<number> {
  const inputs: EvidenceInput[] = [];
  const openPorts = new Set(host.openPorts);
  const webPorts = host.openPorts.filter((p) => WEB_PORTS.has(p));

  const tasks: Array<Promise<void>> = [];

  if (webPorts.length > 0) {
    tasks.push(
      deps
        .httpTls(host.ip, webPorts, { timeoutMs: PROBE_TIMEOUT_MS })
        .then((findings) => {
          if (findings.length > 0) inputs.push(...evidenceFromHttpTls(findings));
        })
        .catch((e) => console.error(`[probes] http-tls ${host.ip} fallito:`, e))
    );
  }

  if (openPorts.has(SMB_PORT)) {
    tasks.push(
      deps
        .smb2(host.ip, { timeoutMs: PROBE_TIMEOUT_MS })
        .then((finding) => {
          if (finding) inputs.push(...evidenceFromSmb2(finding));
        })
        .catch((e) => console.error(`[probes] smb2 ${host.ip} fallito:`, e))
    );
  }

  // mDNS/SSDP/WSD sono UDP e non compaiono nel port scan TCP: tentati comunque
  // per ogni host con almeno una porta aperta (gate 3 già applicato dal chiamante).
  tasks.push(
    deps
      .mdns(host.ip, { timeoutMs: PROBE_TIMEOUT_MS })
      .then((finding) => {
        if (finding) inputs.push(...evidenceFromMdns(finding));
      })
      .catch((e) => console.error(`[probes] mdns ${host.ip} fallito:`, e))
  );
  tasks.push(
    deps
      .ssdp(host.ip, { timeoutMs: PROBE_TIMEOUT_MS })
      .then((finding) => {
        if (finding) inputs.push(...evidenceFromSsdp(finding));
      })
      .catch((e) => console.error(`[probes] ssdp ${host.ip} fallito:`, e))
  );
  tasks.push(
    deps
      .wsd(host.ip, { timeoutMs: PROBE_TIMEOUT_MS })
      .then((finding) => {
        if (finding) inputs.push(...evidenceFromWsd(finding));
      })
      .catch((e) => console.error(`[probes] wsd ${host.ip} fallito:`, e))
  );

  await Promise.all(tasks);

  if (inputs.length === 0) return 0;

  try {
    const written = deps.recordEvidence(host.id, inputs);
    deps.recomputeAttributionSafe(host.id, "scan");
    return written;
  } catch (e) {
    console.error(`[probes] recordEvidence host ${host.ip} fallito:`, e);
    return 0;
  }
}

/**
 * Esegue i probe passivi di attribuzione su un lotto di host di una rete.
 * Vedi commento di testa per gating, budget e concorrenza.
 */
export async function runAttributionProbes(
  networkId: number,
  hosts: ProbeHostInput[],
  opts?: { budgetMs?: number; concurrency?: number; deps?: Partial<ProbeRunDeps> }
): Promise<ProbeRunResult> {
  const start = Date.now();
  const deps: ProbeRunDeps = { ...REAL_DEPS, ...opts?.deps };

  try {
    if (isProbesDisabledGlobally(deps) || isProbesDisabledForNetwork(deps, networkId)) {
      return { hostsProbed: 0, evidenceWritten: 0, skipped: hosts.length, elapsedMs: Date.now() - start };
    }
  } catch (e) {
    console.error(`[probes] gating rete ${networkId} illeggibile, salto i probe (fail-closed):`, e);
    return { hostsProbed: 0, evidenceWritten: 0, skipped: hosts.length, elapsedMs: Date.now() - start };
  }

  const eligible = hosts.filter((h) => h.openPorts && h.openPorts.length > 0);
  const gatedOut = hosts.length - eligible.length;

  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS;
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  const deadline = start + budgetMs;

  const result: ProbeRunResult = { hostsProbed: 0, evidenceWritten: 0, skipped: gatedOut, elapsedMs: 0 };
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (Date.now() >= deadline) return;
      const i = nextIndex++;
      if (i >= eligible.length) return;
      const host = eligible[i];
      result.hostsProbed += 1;
      try {
        // NB: `await` va risolto PRIMA di leggere/sommare `result.evidenceWritten`.
        // `result.evidenceWritten += await probeHost(...)` legge il valore corrente
        // di evidenceWritten PRIMA che l'await sospenda (get-poi-await-poi-set): con
        // più worker concorrenti (pool fino a DEFAULT_CONCURRENCY host in parallelo)
        // due letture "vecchie" si sovrascrivono a vicenda e il conteggio finale
        // riporta solo l'ultimo host invece della somma di tutti (bug reale in
        // produzione: evidenceWritten=5 riportato mentre in DB erano state scritte
        // 35 righe). Separare l'await dalla somma rende il `+=` atomico (nessun
        // punto di sospensione al suo interno, JS è single-thread).
        const written = await probeHost(host, deps);
        result.evidenceWritten += written;
      } catch (e) {
        // Difesa in profondità: probeHost già intercetta tutto internamente.
        console.error(`[probes] host ${host.ip} fallito inaspettatamente:`, e);
      }
    }
  }

  const poolSize = Math.min(concurrency, eligible.length || 1);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  const remaining = eligible.length - result.hostsProbed;
  if (remaining > 0) {
    result.skipped += remaining;
    console.warn(
      `[probes] budget di ${budgetMs}ms scaduto per rete ${networkId}: ${remaining} host non probati su ${eligible.length} idonei`
    );
  }

  result.elapsedMs = Date.now() - start;
  return result;
}
