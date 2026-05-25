"use client";

/**
 * Patch Management — Modal esecuzione bulk con tail log live (F8).
 *
 * Funzionalità:
 *   - Polling status ogni 3s su `/api/patch/operations/[id]` (da F7)
 *   - Polling tail log ogni 2s su `/api/patch/operations/[id]/logs?after_log_id=N`
 *     finché operation non è terminale; un'ultima call dopo `finished=true`
 *     per recuperare il delta finale
 *   - Throttle per-operation: nessuna fetch logs concorrente sulla stessa op
 *   - Sezione output collapsable per host (auto-espansa al primo log)
 *   - Warning prominente reboot_pending (exit 3010/1641)
 *   - Bottone "Annulla rimanenti queued" → POST cancel per ogni op queued
 *   - Limite 500 righe in memoria per op; oltre quel limite ", ... troncato"
 *   - Cleanup completo di tutti i setInterval in unmount/close
 *
 * Props:
 *   - open: visibilità modal
 *   - onClose: callback chiusura (richiede conferma se ci sono op non terminali)
 *   - title: titolo display
 *   - operations: lista { operationId, hostId, hostLabel } da monitorare
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Power,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface HostActionOperation {
  operationId: number;
  hostId: number;
  hostLabel: string;
}

interface OperationState {
  operationId: number;
  hostId: number;
  hostLabel: string;
  status: string;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  rebootRequired: boolean;
  loading: boolean;
  fetchError: string | null;
}

interface LogLine {
  id: number | null;
  ts: string;
  stream: string;
  line: string;
}

interface LogStateEntry {
  lines: LogLine[];
  lastLogId: number;
  expanded: boolean;
  expandedManual: boolean; // true se l'utente ha cliccato il toggle (rispetta sua scelta)
  finalFetchDone: boolean; // true se abbiamo già fatto la call finale post-finished
  fetchError: string | null;
  truncated: boolean;
}

interface HostActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  operations: HostActionOperation[];
}

const TERMINAL_STATUSES = new Set([
  "success",
  "failed",
  "reboot_pending",
  "cancelled",
]);

const STATUS_POLL_INTERVAL_MS = 3000;
const LOGS_POLL_INTERVAL_MS = 2000;
const MAX_LOG_LINES_PER_OP = 500;

function statusBadge(state: OperationState) {
  if (state.fetchError) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        errore poll
      </Badge>
    );
  }
  switch (state.status) {
    case "queued":
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          queued
        </Badge>
      );
    case "running":
      return (
        <Badge variant="default" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          running
        </Badge>
      );
    case "success":
      return (
        <Badge
          variant="default"
          className="gap-1 bg-emerald-600 hover:bg-emerald-700"
        >
          <CheckCircle2 className="h-3 w-3" />
          success
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          failed
        </Badge>
      );
    case "reboot_pending":
      return (
        <Badge
          variant="default"
          className="gap-1 bg-amber-500 hover:bg-amber-600 text-black"
        >
          <AlertTriangle className="h-3 w-3" />
          reboot pending
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="gap-1">
          cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{state.status || "—"}</Badge>;
  }
}

function elapsed(state: OperationState): string {
  if (!state.startedAt) return "—";
  const start = new Date(state.startedAt).getTime();
  const end = state.finishedAt
    ? new Date(state.finishedAt).getTime()
    : Date.now();
  const secs = Math.max(0, Math.floor((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function streamClass(stream: string): string {
  switch (stream) {
    case "stderr":
      return "text-destructive";
    case "system":
      return "text-amber-600 dark:text-amber-400 italic";
    default:
      return "text-foreground";
  }
}

function emptyLogState(): LogStateEntry {
  return {
    lines: [],
    lastLogId: 0,
    expanded: false,
    expandedManual: false,
    finalFetchDone: false,
    fetchError: null,
    truncated: false,
  };
}

export function HostActionModal({
  open,
  onClose,
  title,
  description,
  operations,
}: HostActionModalProps) {
  const [states, setStates] = useState<Record<number, OperationState>>({});
  const [logs, setLogs] = useState<Record<number, LogStateEntry>>({});
  const [cancelling, setCancelling] = useState(false);
  // Tick locale per refresh dell'elapsed time anche tra un poll e l'altro
  const [, setNowTick] = useState(0);

  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Throttle per-op: id → true se una fetch logs è in volo
  const logsInFlightRef = useRef<Record<number, boolean>>({});
  // Snapshot stato per closure delle fetch (evita stale state)
  const statesRef = useRef<Record<number, OperationState>>({});
  const logsRef = useRef<Record<number, LogStateEntry>>({});
  // Refs per i contenitori output → auto-scroll su nuova riga
  const outputContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    statesRef.current = states;
  }, [states]);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  // Inizializza stato status + logs quando cambiano le operations o si riapre
  useEffect(() => {
    if (!open) return;
    setStates((prev) => {
      const next: Record<number, OperationState> = {};
      for (const op of operations) {
        next[op.operationId] = prev[op.operationId] ?? {
          operationId: op.operationId,
          hostId: op.hostId,
          hostLabel: op.hostLabel,
          status: "queued",
          exitCode: null,
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
          rebootRequired: false,
          loading: true,
          fetchError: null,
        };
      }
      return next;
    });
    setLogs((prev) => {
      const next: Record<number, LogStateEntry> = {};
      for (const op of operations) {
        next[op.operationId] = prev[op.operationId] ?? emptyLogState();
      }
      return next;
    });
    // Reset throttle map (no operations cross-modal-open)
    logsInFlightRef.current = {};
  }, [open, operations]);

  // ---- Fetch status singolo (riusato da F7) ----
  const fetchOperation = useCallback(async (operationId: number) => {
    try {
      const res = await fetch(`/api/patch/operations/${operationId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        status: string;
        exitCode: number | null;
        startedAt: string | null;
        finishedAt: string | null;
        errorMessage: string | null;
        rebootRequired: boolean;
      };
      setStates((prev) => ({
        ...prev,
        [operationId]: {
          ...prev[operationId],
          status: data.status,
          exitCode: data.exitCode,
          startedAt: data.startedAt,
          finishedAt: data.finishedAt,
          errorMessage: data.errorMessage,
          rebootRequired: data.rebootRequired,
          loading: false,
          fetchError: null,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore poll";
      setStates((prev) => ({
        ...prev,
        [operationId]: {
          ...prev[operationId],
          loading: false,
          fetchError: msg,
        },
      }));
    }
  }, []);

  // ---- Fetch logs delta per singola operation ----
  const fetchLogs = useCallback(async (operationId: number) => {
    // Throttle: una sola in volo per op
    if (logsInFlightRef.current[operationId]) return;
    logsInFlightRef.current[operationId] = true;

    try {
      const prevLog = logsRef.current[operationId] ?? emptyLogState();
      const after = prevLog.lastLogId;
      const url = `/api/patch/operations/${operationId}/logs?after_log_id=${after}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        lines: LogLine[];
        nextOffset: number;
        lastLogId: number;
        finished: boolean;
        status: string;
      };

      const hasNewLines = Array.isArray(data.lines) && data.lines.length > 0;
      const isFinalCall =
        data.finished && (statesRef.current[operationId]?.status
          ? TERMINAL_STATUSES.has(statesRef.current[operationId].status)
          : false);

      setLogs((prev) => {
        const current = prev[operationId] ?? emptyLogState();
        let mergedLines = current.lines;
        let truncated = current.truncated;

        if (hasNewLines) {
          mergedLines = [...current.lines, ...data.lines];
          if (mergedLines.length > MAX_LOG_LINES_PER_OP) {
            const overflow = mergedLines.length - MAX_LOG_LINES_PER_OP;
            mergedLines = mergedLines.slice(overflow);
            truncated = true;
          }
        }

        return {
          ...prev,
          [operationId]: {
            ...current,
            lines: mergedLines,
            lastLogId: Math.max(current.lastLogId, data.lastLogId ?? 0),
            // Auto-espandi alla prima nuova riga, ma rispetta toggle manuale dell'utente
            expanded:
              current.expandedManual
                ? current.expanded
                : current.expanded || hasNewLines,
            finalFetchDone: data.finished
              ? current.finalFetchDone || isFinalCall
              : current.finalFetchDone,
            fetchError: null,
            truncated,
          },
        };
      });

      // Auto-scroll se contenitore aperto
      if (hasNewLines) {
        // requestAnimationFrame per assicurarci che il DOM sia stato aggiornato
        requestAnimationFrame(() => {
          const el = outputContainerRefs.current[operationId];
          if (el) {
            el.scrollTop = el.scrollHeight;
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore fetch logs";
      setLogs((prev) => {
        const current = prev[operationId] ?? emptyLogState();
        return {
          ...prev,
          [operationId]: { ...current, fetchError: msg },
        };
      });
    } finally {
      logsInFlightRef.current[operationId] = false;
    }
  }, []);

  // ---- Polling status (3s) ----
  useEffect(() => {
    if (!open) return;
    if (operations.length === 0) return;

    const tick = () => {
      for (const op of operations) {
        const st = statesRef.current[op.operationId];
        if (st && TERMINAL_STATUSES.has(st.status) && !st.fetchError) {
          continue;
        }
        void fetchOperation(op.operationId);
      }
    };

    tick();
    statusIntervalRef.current = setInterval(tick, STATUS_POLL_INTERVAL_MS);
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };
  }, [open, operations, fetchOperation]);

  // ---- Polling logs (2s) ----
  useEffect(() => {
    if (!open) return;
    if (operations.length === 0) return;

    const tick = () => {
      for (const op of operations) {
        const st = statesRef.current[op.operationId];
        const logEntry = logsRef.current[op.operationId];
        if (!st) continue;

        const isTerminal = TERMINAL_STATUSES.has(st.status);

        if (isTerminal) {
          // Una sola call finale per recuperare delta dopo finish
          if (logEntry && !logEntry.finalFetchDone) {
            void fetchLogs(op.operationId);
          }
          continue;
        }

        // queued: skip (non c'è log da tailare)
        if (st.status === "queued") continue;

        void fetchLogs(op.operationId);
      }
    };

    // Primo tick immediato
    tick();
    logsIntervalRef.current = setInterval(tick, LOGS_POLL_INTERVAL_MS);
    return () => {
      if (logsIntervalRef.current) {
        clearInterval(logsIntervalRef.current);
        logsIntervalRef.current = null;
      }
    };
  }, [open, operations, fetchLogs]);

  // ---- Tick visuale per elapsed time (1s) ----
  useEffect(() => {
    if (!open) return;
    tickRef.current = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [open]);

  // ---- Cleanup totale on unmount ----
  useEffect(() => {
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (logsIntervalRef.current) clearInterval(logsIntervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const allTerminal = useMemo(() => {
    if (operations.length === 0) return true;
    return operations.every((op) => {
      const st = states[op.operationId];
      return st && TERMINAL_STATUSES.has(st.status);
    });
  }, [operations, states]);

  const counts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;
    let rebootPending = 0;
    let other = 0;
    for (const op of operations) {
      const st = states[op.operationId];
      if (!st) {
        other += 1;
        continue;
      }
      if (st.status === "success") success += 1;
      else if (st.status === "failed") failed += 1;
      else if (st.status === "reboot_pending") {
        success += 1;
        rebootPending += 1;
      } else if (st.status === "running") running += 1;
      else if (st.status === "queued") queued += 1;
      else other += 1;
    }
    return { success, failed, running, queued, rebootPending, other };
  }, [operations, states]);

  const rebootHosts = useMemo(() => {
    return operations
      .map((op) => states[op.operationId])
      .filter(
        (st): st is OperationState =>
          !!st && (st.status === "reboot_pending" || st.rebootRequired)
      );
  }, [operations, states]);

  const toggleExpanded = useCallback((operationId: number) => {
    setLogs((prev) => {
      const current = prev[operationId] ?? emptyLogState();
      return {
        ...prev,
        [operationId]: {
          ...current,
          expanded: !current.expanded,
          expandedManual: true,
        },
      };
    });
  }, []);

  const handleCancelQueued = useCallback(async () => {
    const queuedOps = operations.filter((op) => {
      const st = statesRef.current[op.operationId];
      return st?.status === "queued";
    });
    if (queuedOps.length === 0) return;

    const proceed = window.confirm(
      `Annullare ${queuedOps.length} operation${queuedOps.length === 1 ? "" : "s"} ancora in coda? Le operations già "running" non saranno toccate.`
    );
    if (!proceed) return;

    setCancelling(true);
    try {
      // Sequenziale per evitare di sparare N richieste simultanee
      for (const op of queuedOps) {
        try {
          const res = await fetch(
            `/api/patch/operations/${op.operationId}/cancel`,
            {
              method: "POST",
              cache: "no-store",
            }
          );
          if (!res.ok && res.status !== 409) {
            console.warn(
              `[HostActionModal] cancel op#${op.operationId} HTTP ${res.status}`
            );
          }
        } catch (err) {
          console.warn(
            `[HostActionModal] cancel op#${op.operationId} fallito:`,
            (err as Error).message
          );
        }
        // Refresh immediato dello stato per UX reattiva
        void fetchOperation(op.operationId);
      }
    } finally {
      setCancelling(false);
    }
  }, [operations, fetchOperation]);

  const handleClose = () => {
    if (!allTerminal) {
      const proceed = window.confirm(
        "Ci sono operazioni ancora in corso. Vuoi davvero chiudere? Il polling verrà fermato ma le operations continueranno lato host."
      );
      if (!proceed) return;
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription>
              Polling stato ogni 3s, log live ogni 2s. Chiudi al termine per
              liberare le risorse.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="text-sm text-muted-foreground flex flex-wrap gap-3 py-1">
          <span>
            {operations.length} host •{" "}
            <span className="text-emerald-600 font-medium">
              {counts.success} ok
            </span>{" "}
            •{" "}
            <span className="text-destructive font-medium">
              {counts.failed} fail
            </span>{" "}
            •{" "}
            <span className="text-foreground font-medium">
              {counts.running} in corso
            </span>
            {counts.queued > 0 ? (
              <>
                {" "}
                •{" "}
                <span className="text-muted-foreground">
                  {counts.queued} in coda
                </span>
              </>
            ) : null}
          </span>
        </div>

        {/* Reboot pending warning prominente */}
        {rebootHosts.length > 0 ? (
          <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
            <div className="flex items-start gap-2">
              <Power className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  Riavvio richiesto su{" "}
                  {rebootHosts.length === 1
                    ? rebootHosts[0].hostLabel
                    : `${rebootHosts.length} host`}
                </div>
                {rebootHosts.length > 1 ? (
                  <div className="text-xs text-amber-800 dark:text-amber-300">
                    {rebootHosts.map((s) => s.hostLabel).join(", ")}
                  </div>
                ) : null}
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  Suggerimento: pianifica un reboot manuale per completare
                  l&apos;installazione.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="border rounded-md max-h-[55vh] overflow-y-auto divide-y">
          {operations.map((op) => {
            const st = states[op.operationId];
            const logEntry = logs[op.operationId] ?? emptyLogState();
            const lineCount = logEntry.lines.length;
            const hasOutput = lineCount > 0;
            const isRebootPending =
              st?.status === "reboot_pending" || st?.rebootRequired;

            return (
              <div key={op.operationId} className="p-3 space-y-2">
                {/* Riga principale host */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-medium min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{op.hostLabel}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        #{op.operationId}
                      </span>
                    </div>
                    {st?.errorMessage ? (
                      <div className="text-xs text-destructive mt-0.5 break-words">
                        {st.errorMessage}
                      </div>
                    ) : null}
                    {st?.fetchError ? (
                      <div className="text-xs text-destructive mt-0.5 break-words">
                        poll: {st.fetchError}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {st ? statusBadge(st) : <Badge variant="outline">—</Badge>}
                    {isRebootPending ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-amber-500 text-amber-700 dark:text-amber-300"
                      >
                        <Power className="h-3 w-3" />
                        riavvio
                      </Badge>
                    ) : null}
                    <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
                      {st ? elapsed(st) : "—"}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">
                      exit{" "}
                      {st && st.exitCode !== null ? st.exitCode : "—"}
                    </span>
                  </div>
                </div>

                {/* Sezione output collapsable */}
                <div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(op.operationId)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {logEntry.expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Output
                    {hasOutput ? (
                      <span className="text-muted-foreground/70">
                        ({lineCount}
                        {logEntry.truncated ? "+" : ""} righe)
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70">
                        (in attesa di output)
                      </span>
                    )}
                  </button>

                  {logEntry.expanded ? (
                    <div
                      ref={(el) => {
                        outputContainerRefs.current[op.operationId] = el;
                      }}
                      className="mt-1 border rounded bg-muted/40 font-mono text-xs leading-relaxed p-2 overflow-y-auto"
                      style={{ maxHeight: "200px" }}
                    >
                      {logEntry.truncated ? (
                        <div className="text-amber-600 dark:text-amber-400 italic mb-1">
                          ... (output troncato, mostro ultime{" "}
                          {MAX_LOG_LINES_PER_OP} righe) ...
                        </div>
                      ) : null}
                      {hasOutput ? (
                        logEntry.lines.map((l, idx) => (
                          <div
                            key={
                              l.id !== null
                                ? `id-${l.id}`
                                : `idx-${idx}-${l.ts}`
                            }
                            className={`whitespace-pre-wrap break-all ${streamClass(l.stream)}`}
                          >
                            {l.line}
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground italic">
                          Nessun output ancora.
                        </div>
                      )}
                      {logEntry.fetchError ? (
                        <div className="text-destructive italic mt-1">
                          [errore tail: {logEntry.fetchError}]
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {counts.queued > 0 ? (
            <Button
              variant="outline"
              onClick={handleCancelQueued}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Annullamento...
                </>
              ) : (
                <>Annulla rimanenti ({counts.queued})</>
              )}
            </Button>
          ) : null}
          <Button
            variant={allTerminal ? "default" : "outline"}
            onClick={handleClose}
          >
            {allTerminal ? "Chiudi" : "Chiudi (forza)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
