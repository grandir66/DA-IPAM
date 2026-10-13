// src/components/topology/site-topology-dialog.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { SiteTopologyView } from "@/lib/topology/api-input";

const NESSUNA = "none";

export function SiteTopologyDialog({ location, open, onOpenChange }: {
  location: { id: number; name: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [view, setView] = useState<SiteTopologyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [head, setHead] = useState<string>(NESSUNA);
  const [nets, setNets] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoadError(null);
    const r = await fetchJson<SiteTopologyView>(`/api/locations/${location.id}/topology`, { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    setView(r.data);
    setHead(r.data.head_device_id != null ? String(r.data.head_device_id) : NESSUNA);
    setNets(new Set(r.data.network_ids));
  }, [location.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await fetchJson<SiteTopologyView>(`/api/locations/${location.id}/topology`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ head_device_id: head === NESSUNA ? null : Number(head), network_ids: [...nets] }),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setView(r.data);
    setHead(r.data.head_device_id != null ? String(r.data.head_device_id) : NESSUNA);
    setNets(new Set(r.data.network_ids));
  }

  const TESTA = new Set(["router", "firewall"]);
  const devices = view
    ? [...view.devices].sort(
        (a, b) =>
          Number(TESTA.has(b.device_type)) - Number(TESTA.has(a.device_type)) ||
          a.name.localeCompare(b.name, "it"),
      )
    : [];

  const toggle = (id: number) =>
    setNets((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mappa — {location.name}</DialogTitle>
        </DialogHeader>
        <DialogScrollableArea>
          {loadError && <LoadError what="la mappa della sede" message={loadError} onRetry={load} />}
          {error && (
            <p role="alert" className="mb-3 rounded-md border border-destructive p-3 text-sm">
              Errore: {error}
            </p>
          )}
          {view && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Apparato di testa</Label>
                <Select value={head} onValueChange={(v) => setHead(v ?? NESSUNA)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NESSUNA}>— nessuna —</SelectItem>
                    {devices.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.host}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {view.proposed_head && view.head_device_id == null && (
                  <p className="text-sm">Proposta del sistema: <strong>{view.proposed_head.name}</strong> (gateway di una o più subnet della sede)</p>
                )}
                {view.head_device_id != null && view.head_set_by && view.head_set_at && (
                  <p className="text-sm text-muted-foreground">
                    Scelta da {view.head_set_by} il {parseDbDate(view.head_set_at).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Subnet della sede</Label>
                <ul className="max-h-80 space-y-1 overflow-y-auto">
                  {view.networks.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 text-sm">
                      <Checkbox id={`net-${n.id}`} checked={nets.has(n.id)} onCheckedChange={() => toggle(n.id)} />
                      <label htmlFor={`net-${n.id}`} className="font-mono">{n.cidr}</label>
                      <span>· {n.name}</span>
                      {n.location_id !== null && n.location_id !== location.id && (
                        <span className="text-muted-foreground">— ora in {n.location_name ?? `ubicazione ${n.location_id}`}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogScrollableArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
          <Button onClick={save} disabled={!view || saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
