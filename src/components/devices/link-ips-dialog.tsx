"use client";

/**
 * Modale per collegare manualmente più IP/host allo stesso physical_device.
 *
 * Due mode:
 *   - "add"  — esiste un host "anchor" (già visualizzato in /objects/[id] o
 *              promosso a device). Mostra candidati ordinati per affinity e
 *              permette di aggiungerne uno o più allo stesso cluster.
 *   - "bulk" — l'utente ha già selezionato N host dalla discovery e vuole
 *              dichiararli "stesso device fisico". Conferma e crea/aggiorna il
 *              cluster.
 *
 * Submit: POST /api/physical-devices/link
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Link2 } from "lucide-react";

interface CandidateRow {
  id: number;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  device_manufacturer: string | null;
  inferred_os_family: string | null;
  network_id: number;
  network_name: string;
  physical_device_id: number | null;
  affinity_score: number;
  reasons: string[];
}

interface LinkIpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamato dopo link riuscito con il physical_device_id risultante */
  onLinked?: (physicalDeviceId: number, linkedHostIds: number[]) => void;

  /** mode="add": host anchor da cui si parte (la sua scheda è aperta) */
  anchorHostId?: number;
  anchorHostLabel?: string;

  /** mode="bulk": host già selezionati nella lista di discovery */
  preSelectedHostIds?: number[];
  preSelectedHostLabels?: Record<number, string>; // id → label per UI
}

export function LinkIpsDialog({
  open,
  onOpenChange,
  onLinked,
  anchorHostId,
  anchorHostLabel,
  preSelectedHostIds,
  preSelectedHostLabels,
}: LinkIpsDialogProps) {
  const mode: "add" | "bulk" = anchorHostId ? "add" : "bulk";
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Carica i candidati quando il modale si apre in mode="add"
  useEffect(() => {
    if (!open || mode !== "add" || !anchorHostId) return;
    setLoadingCandidates(true);
    setSelectedIds(new Set());
    fetch(`/api/hosts/${anchorHostId}/link-candidates?limit=50`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((data: { candidates: CandidateRow[] }) => setCandidates(data.candidates ?? []))
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }, [open, mode, anchorHostId]);

  const filteredCandidates = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter((c) =>
      c.ip.includes(q) ||
      (c.hostname?.toLowerCase().includes(q) ?? false) ||
      (c.vendor?.toLowerCase().includes(q) ?? false) ||
      c.network_name.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      let hostIds: number[];
      if (mode === "add") {
        if (!anchorHostId) throw new Error("Host anchor mancante");
        if (selectedIds.size === 0) {
          toast.error("Seleziona almeno un host da collegare");
          setSubmitting(false);
          return;
        }
        hostIds = [anchorHostId, ...Array.from(selectedIds)];
      } else {
        hostIds = preSelectedHostIds ?? [];
        if (hostIds.length < 2) {
          toast.error("Servono almeno 2 host per il link manuale");
          setSubmitting(false);
          return;
        }
      }

      const res = await fetch("/api/physical-devices/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: hostIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nel link manuale");
        return;
      }
      const result = await res.json() as { physical_device_id: number; linked_host_ids: number[]; created: boolean };
      toast.success(
        result.created
          ? `Device fisico creato con ${result.linked_host_ids.length} IP collegati`
          : `${result.linked_host_ids.length} IP collegati al device esistente`,
      );
      onOpenChange(false);
      onLinked?.(result.physical_device_id, result.linked_host_ids);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            {mode === "add"
              ? `Collega un altro IP a ${anchorHostLabel ?? "questo device"}`
              : `Marca ${preSelectedHostIds?.length ?? 0} host come stesso device fisico`}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Seleziona uno o più IP che appartengono allo stesso device fisico. Ordinati per affinità (rete, vendor, OS, OUI MAC, prefisso hostname)."
              : "Tutti gli host selezionati diventeranno la stessa entità fisica. Usalo quando il sistema non è riuscito ad aggregarli automaticamente."}
          </DialogDescription>
        </DialogHeader>

        <DialogScrollableArea className="px-4 py-3 space-y-3">
          {mode === "add" && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="Cerca per IP, hostname, vendor, rete…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {loadingCandidates && (
                <p className="text-sm text-muted-foreground py-4 text-center">Caricamento candidati…</p>
              )}
              {!loadingCandidates && filteredCandidates.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {search ? "Nessun risultato per la ricerca." : "Nessun host candidato disponibile."}
                </p>
              )}
              {!loadingCandidates && filteredCandidates.length > 0 && (
                <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                  {filteredCandidates.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-start gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggle(c.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{c.ip}</span>
                          {c.hostname && <span className="text-sm text-muted-foreground truncate">{c.hostname}</span>}
                          {c.physical_device_id && (
                            <Badge variant="outline" className="text-[10px]">già in cluster #{c.physical_device_id}</Badge>
                          )}
                          {c.affinity_score >= 50 && (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              affinità {c.affinity_score}
                            </Badge>
                          )}
                          {c.affinity_score > 0 && c.affinity_score < 50 && (
                            <Badge variant="secondary" className="text-[10px]">aff. {c.affinity_score}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                          <span>{c.network_name}</span>
                          {c.vendor && <span>vendor: {c.vendor}</span>}
                          {c.inferred_os_family && <span>OS: {c.inferred_os_family}</span>}
                        </div>
                        {c.reasons.length > 0 && (
                          <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                            {c.reasons.join(" · ")}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "bulk" && (
            <div className="space-y-2">
              <p className="text-sm">Verranno linkati i seguenti host:</p>
              <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                {(preSelectedHostIds ?? []).map((id) => (
                  <div key={id} className="px-3 py-1.5 text-sm font-mono">
                    {preSelectedHostLabels?.[id] ?? `Host #${id}`}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Se uno degli host ha già un device fisico associato, gli altri verranno aggiunti a quel cluster.
                Altrimenti verrà creato un nuovo device fisico (anchor: <code>manual_link</code>).
              </p>
            </div>
          )}
        </DialogScrollableArea>

        <DialogFooter className="px-4 py-3 border-t border-border/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Annulla</Button>
          <Button onClick={handleSubmit} disabled={submitting || (mode === "add" && selectedIds.size === 0)}>
            {submitting
              ? "Collegamento…"
              : mode === "add"
              ? `Collega ${selectedIds.size > 0 ? `(${selectedIds.size})` : ""}`
              : "Conferma link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
