/**
 * Tipi pubblici dell'astrazione Executor.
 *
 * L'Executor è la frontiera tra hub orchestratore e nodo che esegue I/O di rete.
 * Esiste solo `LocalExecutor` (esecuzione in-process): l'agente remoto è tolto
 * (20/10/2026, decisione 26 della spec NetBird).
 */

import type { PingResult, NmapResult } from "@/types";
import type { DnsResolution } from "@/lib/scanner/dns";

export type ExecutorMode = "local";

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
