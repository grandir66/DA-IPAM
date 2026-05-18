/**
 * Tipi pubblici dell'astrazione Executor.
 *
 * L'Executor è la frontiera tra hub orchestratore e nodo che esegue I/O di rete.
 * In Phase 1 esiste solo `LocalExecutor` (esecuzione in-process). In Phase 3
 * verrà aggiunto `RemoteExecutor` che invocherà un agente Python via Tailscale.
 *
 * Le firme dei metodi sono pensate per essere serializzabili JSON: callback
 * opzionali (progress/log) sono utili solo lato `local` e verranno ignorati
 * lato `remote` (Phase 3+).
 */

import type { PingResult, NmapResult } from "@/types";
import type { DnsResolution } from "@/lib/scanner/dns";

export type ExecutorMode = "local" | "remote";

export interface HealthCheckResult {
  ok: boolean;
  version?: string;
  mode: ExecutorMode;
  error?: string;
}

export interface PingSweepCallbacks {
  onProgress?: (scanned: number, found: number) => void;
}

export interface NmapPortScanOptions {
  customArgs?: string;
  timeoutMs?: number;
  skipUdp?: boolean;
  udpPorts?: string | null;
}

export interface NmapPortScanCallbacks {
  onLog?: (msg: string) => void;
}

export interface DnsBatchCallbacks {
  onProgress?: (completed: number, total: number) => void;
}

export type { PingResult, NmapResult, DnsResolution };
