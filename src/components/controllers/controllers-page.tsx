"use client";

/**
 * Pagina «Controller di rete»: una riga per controller, una colonna per dato.
 * Lo stato si distingue per forma e luminanza (● pieno scuro, ○ chiaro,
 * ▲ rosso pieno), non solo per colore. Le azioni sono dell'amministratore.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { NetworkControllerView } from "@/lib/controllers/types";
import { ControllerDetail } from "./controller-detail";
import { ControllerDialog } from "./controller-dialog";
import {
  buildTogglePayload,
  controllerStatus,
  countOrDash,
  describeSync,
  formatRome,
  kindLabel,
  parseControllerList,
  parseProbeResult,
  parseSyncResponse,
  probeOneLine,
  scheduleLabel,
  type ProbeResult,
  type ControllerStatusKey,
} from "./controllers-model";

const STATUS_CLASS: Record<ControllerStatusKey, string> = {
  active: "bg-[#0D2537] text-white border-[#0D2537]",
  off: "bg-white text-[#0D2537] border-[#0D2537]/40",
  error: "bg-[#B3201F] text-white border-[#B3201F]",
};

const LINE_CLASS = {
  ok: "text-green-800",
  warning: "text-amber-800",
  error: "text-destructive",
} as const;

type Line = { tone: keyof typeof LINE_CLASS; text: string };
type Confirm = { kind: "sync" | "delete"; controller: NetworkControllerView };

const COLUMNS = 11;

export function ControllersPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";

  const [controllers, setControllers] = useState<NetworkControllerView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ controller: NetworkControllerView | null } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<number, "test" | "sync" | "toggle" | "delete">>({});
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [probes, setProbes] = useState<Record<number, ProbeResult>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [detailKey, setDetailKey] = useState(0);

  const load = useCallback(async () => {
    const r = await fetchJson<unknown>("/api/controllers", { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    const list = parseControllerList(r.data);
    if (!list) {
      setLoadError("Risposta non valida dal server");
      return;
    }
    setLoadError(null);
    setControllers(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setBusyFor = (id: number, v: "test" | "sync" | "toggle" | "delete" | null) =>
    setBusy((b) => {
      const next = { ...b };
      if (v) next[id] = v;
      else delete next[id];
      return next;
    });
  const setLine = (id: number, line: Line | null) =>
    setLines((l) => {
      const next = { ...l };
      if (line) next[id] = line;
      else delete next[id];
      return next;
    });

  const runTest = async (c: NetworkControllerView) => {
    setBusyFor(c.id, "test");
    setLine(c.id, null);
    try {
      const r = await fetchJson<unknown>(`/api/controllers/${c.id}/test`, { method: "POST", cache: "no-store" });
      if (!r.ok) {
        setLine(c.id, { tone: "error", text: `Prova non eseguita: ${r.message}` });
        return;
      }
      const p = parseProbeResult(r.data);
      if (!p) {
        setLine(c.id, { tone: "error", text: "Risposta della prova non leggibile" });
        return;
      }
      setProbes((m) => ({ ...m, [c.id]: p }));
      setLine(c.id, { tone: p.ok ? "ok" : "error", text: probeOneLine(p) });
      if (!p.ok && p.reason === "cert") setExpanded(c.id);
      await load();
    } finally {
      setBusyFor(c.id, null);
    }
  };

  const runSync = async (c: NetworkControllerView) => {
    setBusyFor(c.id, "sync");
    setLine(c.id, null);
    try {
      const r = await fetchJson<unknown>(`/api/controllers/${c.id}/sync`, { method: "POST" });
      if (!r.ok) {
        setLine(c.id, { tone: "error", text: `Sincronizzazione non eseguita: ${r.message}` });
        return;
      }
      const s = parseSyncResponse(r.data);
      if (!s) {
        setLine(c.id, { tone: "error", text: "Risposta della sincronizzazione non leggibile" });
        return;
      }
      const v = describeSync(s);
      setLine(c.id, { tone: v.tone, text: v.text });
      setDetailKey((k) => k + 1);
      await load();
    } finally {
      setBusyFor(c.id, null);
    }
  };

  const toggle = async (c: NetworkControllerView) => {
    setBusyFor(c.id, "toggle");
    try {
      const r = await fetchJson<unknown>(`/api/controllers/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTogglePayload(c)),
      });
      if (!r.ok) {
        toast.error(`Controller non aggiornato: ${r.message}`);
        return;
      }
      toast.success(c.enabled ? "Controller disattivato" : "Controller attivato");
      await load();
    } finally {
      setBusyFor(c.id, null);
    }
  };

  const remove = async (c: NetworkControllerView) => {
    setBusyFor(c.id, "delete");
    try {
      const r = await fetchJson<unknown>(`/api/controllers/${c.id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error(`Controller non eliminato: ${r.message}`);
        return;
      }
      toast.success("Controller eliminato");
      if (expanded === c.id) setExpanded(null);
      await load();
    } finally {
      setBusyFor(c.id, null);
    }
  };

  const confirmed = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === "sync") void runSync(c.controller);
    else void remove(c.controller);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Controller di rete</h1>
        {isAdmin && (
          <Button onClick={() => setDialog({ controller: null })}>
            <Plus className="h-4 w-4 mr-1" />
            Aggiungi controller
          </Button>
        )}
      </div>

      {loadError ? (
        <LoadError what="i controller di rete" message={loadError} onRetry={() => void load()} />
      ) : !controllers ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : controllers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nessun controller configurato.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Ultima lettura</TableHead>
                  <TableHead className="text-right">Apparati</TableHead>
                  <TableHead className="text-right">Porte</TableHead>
                  <TableHead className="text-right">Vicini</TableHead>
                  <TableHead>Pianificazione</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {controllers.map((c) => {
                  const st = controllerStatus(c);
                  const b = busy[c.id];
                  const line = lines[c.id];
                  const open = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <TableRow
                        className="cursor-pointer align-top"
                        onClick={() => setExpanded(open ? null : c.id)}
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {c.name}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{kindLabel(c.kind)}</TableCell>
                        <TableCell className="font-mono text-[13px]">{c.url}</TableCell>
                        <TableCell className="font-mono text-[13px]">{c.site}</TableCell>
                        <TableCell>
                          <span
                            title={st.tooltip ?? undefined}
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap ${STATUS_CLASS[st.key]}`}
                          >
                            {st.label}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap" title={c.lastMessage ?? undefined}>
                          {formatRome(c.lastRunAt)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{countOrDash(c.lastDevices)}</TableCell>
                        <TableCell className="text-right tabular-nums">{countOrDash(c.lastPorts)}</TableCell>
                        <TableCell className="text-right tabular-nums">{countOrDash(c.lastNeighbors)}</TableCell>
                        <TableCell className="whitespace-nowrap">{scheduleLabel(c.scheduleMinutes)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {isAdmin ? (
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" variant="outline" disabled={!!b} onClick={() => void runTest(c)}>
                                {b === "test" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                                Prova
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!b}
                                onClick={() => setConfirm({ kind: "sync", controller: c })}
                              >
                                {b === "sync" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                                Sincronizza ora
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button size="icon" variant="ghost" disabled={!!b} aria-label="Altre azioni">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setDialog({ controller: c })}>Modifica</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setExpanded(c.id)}>Certificato</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => void toggle(c)}>
                                    {c.enabled ? "Disattiva" : "Attiva"}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => setConfirm({ kind: "delete", controller: c })}
                                  >
                                    Elimina
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                          {line && <p className={`mt-1 max-w-xs text-[13px] ${LINE_CLASS[line.tone]}`}>{line.text}</p>}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMNS} className="bg-muted/30 whitespace-normal">
                            <ControllerDetail
                              controller={c}
                              lastProbe={probes[c.id] ?? null}
                              isAdmin={isAdmin}
                              refreshKey={detailKey}
                              onChanged={() => void load()}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog && (
        <ControllerDialog
          controller={dialog.controller}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "delete"
                ? `Eliminare «${confirm.controller.name}»?`
                : `Sincronizzare «${confirm?.controller.name ?? ""}»?`}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "delete"
                ? "Il controller non verrà più letto. Gli apparati già acquisiti restano nel database."
                : "Legge il controller e scrive apparati, porte e vicini nel database. Continuare?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Annulla
            </Button>
            <Button variant={confirm?.kind === "delete" ? "destructive" : "default"} onClick={confirmed}>
              {confirm?.kind === "delete" ? "Elimina" : "Sincronizza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

