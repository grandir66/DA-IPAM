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
import { ipToLong } from "@/lib/utils";

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
  /** L'IP è già quello di un apparato gestito: il cluster non permette di scegliere il principale. */
  ha_apparato?: boolean;
}

interface LinkIpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamato dopo link riuscito con il physical_device_id risultante */
  onLinked?: (physicalDeviceId: number, linkedHostIds: number[]) => void;

  /** mode="add": host anchor da cui si parte (la sua scheda è aperta) */
  anchorHostId?: number;
  anchorHostLabel?: string;
  /** IP dell'anchor e dei suoi attuali compagni di cluster, per la scelta del principale. */
  anchorIp?: string;
  anchorMembri?: Array<{ id: number; ip: string }>;
  /** L'anchor (o il suo cluster) ha un apparato gestito: il suo IP è il principale e la scelta non c'è. */
  anchorHaApparato?: boolean;
  /** Principale di oggi del cluster dell'anchor, se c'è. */
  anchorPrincipaleHostId?: number | null;

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
  anchorIp,
  anchorMembri,
  anchorHaApparato,
  anchorPrincipaleHostId,
  preSelectedHostIds,
  preSelectedHostLabels,
}: LinkIpsDialogProps) {
  const mode: "add" | "bulk" = anchorHostId ? "add" : "bulk";
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Principale scelto a mano (null = non toccato: vale la regola, e non si manda niente al server).
  const [principaleScelto, setPrincipaleScelto] = useState<number | null>(null);

  // Carica i candidati quando il modale si apre in mode="add"
  useEffect(() => {
    if (!open || mode !== "add" || !anchorHostId) return;
    setLoadingCandidates(true);
    setSelectedIds(new Set());
    setPrincipaleScelto(null);
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

  // Candidati al ruolo di principale: l'anchor con i suoi compagni di cluster e gli IP che si stanno collegando.
  // Non c'è scelta se qualcuno è un apparato gestito (il suo IP è il principale per regola).
  const sceltaPrincipale = useMemo(() => {
    if (mode !== "add" || !anchorHostId || selectedIds.size === 0 || anchorHaApparato) return null;
    const scelti = candidates.filter((c) => selectedIds.has(c.id));
    if (scelti.some((c) => c.ha_apparato)) return null;
    const righe = new Map<number, string>();
    for (const m of anchorMembri ?? []) righe.set(m.id, m.ip);
    if (!righe.has(anchorHostId) && anchorIp) righe.set(anchorHostId, anchorIp);
    for (const c of scelti) righe.set(c.id, c.ip);
    const elenco = [...righe].map(([id, ip]) => ({ id, ip })).sort((a, b) => ipToLong(a.ip) - ipToLong(b.ip));
    const predefinito = anchorPrincipaleHostId != null && righe.has(anchorPrincipaleHostId) ? anchorPrincipaleHostId : elenco[0]?.id ?? null;
    return { elenco, predefinito };
  }, [mode, anchorHostId, selectedIds, anchorHaApparato, candidates, anchorMembri, anchorIp, anchorPrincipaleHostId]);

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
        body: JSON.stringify({
          host_ids: hostIds,
          // Solo se chi collega ha scelto davvero un principale e lo vede ancora nell'elenco.
          ...(principaleScelto !== null && sceltaPrincipale?.elenco.some((r) => r.id === principaleScelto) ? { principale_host_id: principaleScelto } : {}),
        }),
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

          {mode === "add" && sceltaPrincipale && (
            <fieldset className="border rounded-md px-3 py-2 space-y-1.5">
              <legend className="px-1 text-[13px] font-semibold">Quale IP porta la riga in Discovery?</legend>
              {sceltaPrincipale.elenco.map((r) => {
                const attivo = (principaleScelto ?? sceltaPrincipale.predefinito) === r.id;
                return (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="principale-cluster"
                      checked={attivo}
                      onChange={() => setPrincipaleScelto(r.id)}
                    />
                    <span className="font-mono">{r.ip}</span>
                    {r.id === sceltaPrincipale.predefinito && <span className="text-[13px] text-muted-foreground">· oggi</span>}
                  </label>
                );
              })}
              <p className="text-[13px] text-muted-foreground">Gli altri restano sotto «+N IP». Si può cambiare dopo, dalla scheda.</p>
            </fieldset>
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
