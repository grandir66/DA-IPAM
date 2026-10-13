// src/components/topology/device-location-field.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { DeviceLocationView } from "@/lib/topology/api-input";
import type { Location } from "@/types";

const NESSUNA = "none";

function labels(locs: Location[]): Array<{ id: number; label: string }> {
  const byId = new Map(locs.map((l) => [l.id, l]));
  const full = (l: Location): string => {
    const parts: string[] = [];
    const seen = new Set<number>();
    for (let cur: Location | undefined = l; cur && !seen.has(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined) {
      seen.add(cur.id);
      parts.unshift(cur.name);
    }
    return parts.join(" › ");
  };
  return locs.map((l) => ({ id: l.id, label: full(l) })).sort((a, b) => a.label.localeCompare(b.label, "it"));
}

export function DeviceLocationField({ deviceId, onReady }: { deviceId: number; onReady: (save: () => Promise<string | null>) => void }) {
  const [opts, setOpts] = useState<Array<{ id: number; label: string }>>([]);
  const [view, setView] = useState<DeviceLocationView | null>(null);
  const [value, setValue] = useState(NESSUNA);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [l, v] = await Promise.all([
        fetchJson<Location[]>("/api/locations", { cache: "no-store" }),
        fetchJson<DeviceLocationView>(`/api/devices/${deviceId}/location`, { cache: "no-store" }),
      ]);
      if (!alive) return;
      if (!l.ok || !v.ok) {
        setError(!l.ok ? l.message : !v.ok ? v.message : null);
        return;
      }
      setOpts(labels(l.data));
      setView(v.data);
      setValue(v.data.location_id != null ? String(v.data.location_id) : NESSUNA);
    })();
    return () => {
      alive = false;
    };
  }, [deviceId]);

  useEffect(() => {
    onReady(async () => {
      if (!view) return null; // campo non caricato: l'errore è già nel campo, nulla da salvare
      const next = valueRef.current === NESSUNA ? null : Number(valueRef.current);
      if (next === view.location_id) return null;
      const r = await fetchJson<DeviceLocationView>(`/api/devices/${deviceId}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_id: next }),
      });
      return r.ok ? null : `Sede non salvata: ${r.message}`;
    });
  }, [deviceId, view, error, onReady]);

  return (
    <div className="space-y-2">
      <Label>Sede / armadio</Label>
      {error ? (
        <p className="text-sm">Sede non disponibile: {error}</p>
      ) : (
        <Select value={value} onValueChange={(v) => setValue(v ?? NESSUNA)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NESSUNA}>— nessuna —</SelectItem>
            {opts.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {view?.location_id == null && view?.proposed_site && (
        <p className="text-sm">Proposta del sistema: <strong>{view.proposed_site.name}</strong></p>
      )}
      {view?.location_id != null && view.location_set_by && view.location_set_at && (
        <p className="text-sm text-muted-foreground">
          Scelta da {view.location_set_by} il {parseDbDate(view.location_set_at).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}
        </p>
      )}
    </div>
  );
}
