"use client";

/**
 * Patch Management — Modal esecuzione bulk (F7 base).
 *
 * Mostra una tabella di operations in corso (probe/bootstrap/upgrade) con
 * polling 3s su `/api/patch/operations/[id]`. Il refresh dello stato si
 * ferma quando tutte le operations sono in stato terminale.
 *
 * F8 raffinerà con log live tail (richiamando `/api/patch/operations/[id]/logs`)
 * e una progress bar per riga; qui ci limitiamo a status + exit code + tempo.
 *
 * Props:
 *   - open: visibilità modal
 *   - onClose: callback chiusura (no-op finché qualche op è in running, salvo conferma)
 *   - title: titolo display
 *   - operations: lista { operationId, hostId, hostLabel } da monitorare
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

const POLL_INTERVAL_MS = 3000;

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

export function HostActionModal({
  open,
  onClose,
  title,
  description,
  operations,
}: HostActionModalProps) {
  const [states, setStates] = useState<Record<number, OperationState>>({});
  // Tick locale per refresh dell'elapsed time anche tra un poll e l'altro
  const [, setNowTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inizializza lo stato quando cambiano le operations o si riapre
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
  }, [open, operations]);

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

  // Polling: 1 tick subito + intervallo 3s, finché esistono ops non terminali
  useEffect(() => {
    if (!open) return;
    if (operations.length === 0) return;

    const tick = () => {
      for (const op of operations) {
        const st = states[op.operationId];
        if (st && TERMINAL_STATUSES.has(st.status) && !st.fetchError) {
          continue; // già terminale, non rifetch
        }
        void fetchOperation(op.operationId);
      }
    };

    // Primo tick immediato
    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // operations + open: re-arm su cambio set ops. states intenzionalmente escluso
    // per evitare loop: la lettura avviene tramite closure ogni tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operations, fetchOperation]);

  // Tick visuale (per elapsed time) ogni 1s mentre il modal è aperto
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
    let other = 0;
    for (const op of operations) {
      const st = states[op.operationId];
      if (!st) {
        other += 1;
        continue;
      }
      if (st.status === "success") success += 1;
      else if (st.status === "failed") failed += 1;
      else if (st.status === "running" || st.status === "queued") running += 1;
      else other += 1;
    }
    return { success, failed, running, other };
  }, [operations, states]);

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription>
              Polling stato ogni 3s. Chiudi al termine per liberare le risorse.
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
          </span>
        </div>

        <div className="border rounded-md max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead className="w-20">Op #</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-20 text-right">Exit</TableHead>
                <TableHead className="w-24 text-right">Durata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((op) => {
                const st = states[op.operationId];
                return (
                  <TableRow key={op.operationId}>
                    <TableCell className="font-medium">
                      {op.hostLabel}
                      {st?.errorMessage ? (
                        <div className="text-xs text-destructive mt-1 break-words">
                          {st.errorMessage}
                        </div>
                      ) : null}
                      {st?.fetchError ? (
                        <div className="text-xs text-destructive mt-1 break-words">
                          poll: {st.fetchError}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      #{op.operationId}
                    </TableCell>
                    <TableCell>
                      {st ? (
                        statusBadge(st)
                      ) : (
                        <Badge variant="outline">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {st && st.exitCode !== null ? st.exitCode : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {st ? elapsed(st) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
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
