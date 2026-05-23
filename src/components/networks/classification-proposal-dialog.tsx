"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogScrollableArea, DIALOG_PANEL_WIDE_CLASS } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type Proposal = {
  host_id: number;
  ip: string;
  hostname: string | null;
  current: string | null;
  proposed: string;
  reason: string;
  manual: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkId: number;
  onApplied?: () => void;
};

export function ClassificationProposalDialog({ open, onOpenChange, networkId, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    void loadProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, networkId]);

  async function loadProposals() {
    setLoading(true);
    setProposals([]);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/networks/${networkId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Errore caricamento proposte");
        return;
      }
      const list = (data.proposals ?? []) as Proposal[];
      setProposals(list);
      // Default selection: tutti tranne i manual
      setSelected(new Set(list.filter((p) => !p.manual).map((p) => p.host_id)));
    } catch {
      toast.error("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  function toggleOne(hostId: number) {
    const next = new Set(selected);
    if (next.has(hostId)) next.delete(hostId);
    else next.add(hostId);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === proposals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(proposals.map((p) => p.host_id)));
    }
  }

  async function applySelected(force: boolean) {
    if (selected.size === 0) {
      toast.error("Nessun host selezionato");
      return;
    }
    if (force && !confirm(`Forzare ${selected.size} riclassificazioni anche su host con classificazione manuale?`)) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/networks/${networkId}/apply-classifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: Array.from(selected), force }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Errore applicazione");
        return;
      }
      toast.success(data.message);
      onApplied?.();
      onOpenChange(false);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setApplying(false);
    }
  }

  const allChecked = proposals.length > 0 && selected.size === proposals.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Proposte di riclassificazione</DialogTitle>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Calcolo proposte…
            </div>
          ) : proposals.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Nessuna proposta: tutte le classificazioni risultano coerenti con regole e fingerprint correnti.
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
                    {selected.size} / {proposals.length} selezionati
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Default: deselezionati gli host con classificazione manuale.
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Attuale → Proposta</TableHead>
                    <TableHead>Origine</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((p) => (
                    <TableRow key={p.host_id} className={p.manual ? "opacity-70" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(p.host_id)}
                          onCheckedChange={() => toggleOne(p.host_id)}
                          aria-label={`Seleziona ${p.ip}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.ip}</TableCell>
                      <TableCell className="text-xs">{p.hostname ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground">{p.current ?? "—"}</span>
                        <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
                        <span className="font-medium">{p.proposed}</span>
                        {p.manual && (
                          <Badge variant="outline" className="ml-2 text-[10px] py-0">manuale</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.reason}</TableCell>
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
            variant="outline"
            onClick={() => applySelected(true)}
            disabled={applying || selected.size === 0 || proposals.length === 0}
            className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950"
            title="Applica anche su classification_manual=1"
          >
            Forza selezionati
          </Button>
          <Button
            onClick={() => applySelected(false)}
            disabled={applying || selected.size === 0 || proposals.length === 0}
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Applica selezionati
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
