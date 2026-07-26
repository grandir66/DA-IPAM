"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogScrollableArea, DIALOG_PANEL_WIDE_CLASS } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Dimension = "vendor" | "category" | "os";

const DIMENSION_LABELS: Record<Dimension, string> = {
  vendor: "Vendor",
  category: "Categoria",
  os: "OS",
};

type PreviewDimensionChange = {
  dimension: Dimension;
  before: string | null;
  after: string | null;
  confidence: number;
  evidence: Array<{ source: string; claim: string; raw_value: string | null }>;
  min_phase: string | null;
};

type PreviewChange = {
  host_id: number;
  ip: string;
  hostname: string | null;
  manual: boolean;
  dimensions: PreviewDimensionChange[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkId: number;
  onApplied?: () => void;
};

/** Testo del tooltip per una dimensione: evidenze citate + fase minima richiesta. */
function dimensionTooltip(d: PreviewDimensionChange): string {
  const lines = d.evidence.map((e) => `${e.source}: ${e.claim}${e.raw_value ? ` (${e.raw_value})` : ""}`);
  if (d.min_phase) lines.push(`Richiede: ${d.min_phase}`);
  return lines.join("\n") || "Nessuna evidenza citata";
}

export function AttributionPreviewDialog({ open, onOpenChange, networkId, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [changes, setChanges] = useState<PreviewChange[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, networkId]);

  async function loadPreview() {
    setLoading(true);
    setChanges([]);
    setSelected(new Set());
    setTotal(0);
    try {
      const res = await fetch("/api/attribution/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: networkId, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "Errore nel calcolo dell'anteprima");
        return;
      }
      const list = (data.changes ?? []) as PreviewChange[];
      setChanges(list);
      setTotal((data.total as number | undefined) ?? list.length);
      // Default selection: tutti tranne gli host con evidenza manual (non selezionabili)
      setSelected(new Set(list.filter((c) => !c.manual).map((c) => c.host_id)));
    } catch {
      toast.error("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  const selectableIds = changes.filter((c) => !c.manual).map((c) => c.host_id);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleOne(hostId: number) {
    const next = new Set(selected);
    if (next.has(hostId)) next.delete(hostId);
    else next.add(hostId);
    setSelected(next);
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  async function applySelected() {
    if (selected.size === 0) {
      toast.error("Nessun host selezionato");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch("/api/attribution/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "Errore nell'applicazione dell'attribuzione");
        return;
      }
      toast.success((data as { message?: string }).message || "Attribuzione applicata");
      // transitorio fino a Fase 4: allinea la classificazione legacy visibile in tabella
      await fetch(`/api/networks/${networkId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
      onApplied?.();
      onOpenChange(false);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Anteprima attribuzione</DialogTitle>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Calcolo anteprima…
            </div>
          ) : changes.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm space-y-2">
              <CheckCircle2 className="h-8 w-8 mx-auto text-success" />
              <p>
                Nessun cambiamento: l&apos;attribuzione è già coerente con le evidenze raccolte
                {total > 0 ? ` (${total} host valutati)` : ""}.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 text-sm">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    aria-label="Seleziona tutti"
                  />
                  <span className="text-muted-foreground">
                    {selected.size} / {selectableIds.length} selezionati
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {changes.length} cambiamenti su {total} host valutati. Deselezionati gli host con evidenza manuale (non applicabili).
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Cambiamenti</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.host_id} className={c.manual ? "opacity-70" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(c.host_id)}
                          onCheckedChange={() => toggleOne(c.host_id)}
                          disabled={c.manual}
                          aria-label={`Seleziona ${c.ip}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs align-top">{c.ip}</TableCell>
                      <TableCell className="text-xs align-top">
                        {c.hostname ?? "—"}
                        {c.manual && (
                          <Badge variant="outline" className="ml-2 text-[10px] py-0">manuale</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col gap-1">
                          {c.dimensions.map((d) => (
                            <div key={d.dimension} title={dimensionTooltip(d)} className="flex items-center gap-1 flex-wrap">
                              <span className="font-medium text-foreground">{DIMENSION_LABELS[d.dimension]}:</span>
                              <span className="text-muted-foreground">{d.before ?? "—"}</span>
                              <ArrowRight className="inline h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">{d.after ?? "—"}</span>
                              <Badge variant="outline" className="text-[10px] py-0">{d.confidence}%</Badge>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </DialogScrollableArea>
        <div className="shrink-0 border-t border-border/50 px-4 py-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>
            Annulla
          </Button>
          <Button
            onClick={() => void applySelected()}
            disabled={applying || selected.size === 0 || changes.length === 0}
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Applica selezionati
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
