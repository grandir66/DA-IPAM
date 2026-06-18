"use client";

/**
 * Sezione "DNS autoritativo" (PowerDNS) della pagina Network Services.
 * CRUD completo: zone (create + list, NO delete — non esposto dal bridge),
 * record (list + add + delete) per la zona selezionata.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Server, Plus, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DnsZone, DnsRecord } from "@/lib/network-services/client";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA"];

interface Props {
  isAdmin: boolean;
  /** true se il servizio pdns è attivo (status.services.dns.active === "active"). */
  active: boolean;
}

export function DnsSection({ isAdmin, active }: Props) {
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newZone, setNewZone] = useState("");
  const [newRec, setNewRec] = useState({ name: "", type: "A", content: "", ttl: "3600" });

  const loadZones = useCallback(async () => {
    try {
      const r = await fetch("/api/network-services/dns/zones", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "zones fetch failed");
      const zs: DnsZone[] = d.zones || [];
      setZones(zs);
      setError(null);
      setSelected((prev) => prev ?? (zs.length > 0 ? zs[0].name : null));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadRecords = useCallback(async (zone: string) => {
    try {
      const r = await fetch(`/api/network-services/dns/zones/${encodeURIComponent(zone)}/records`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "records fetch failed");
      setRecords(d.records || []);
    } catch (e) {
      toast.error(`Caricamento record fallito: ${e}`);
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    if (active) loadZones();
  }, [active, loadZones]);

  useEffect(() => {
    if (selected) loadRecords(selected);
    else setRecords([]);
  }, [selected, loadRecords]);

  function addZone() {
    if (!newZone.trim()) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/dns/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone: newZone.trim() }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(`Creazione zona fallita: ${d.error || r.statusText}`);
        return;
      }
      toast.success(`Zona ${newZone.trim()} creata`);
      const created = newZone.trim();
      setNewZone("");
      await loadZones();
      setSelected(created.endsWith(".") ? created : `${created}.`);
    });
  }

  function addRecord() {
    if (!selected || !newRec.name.trim() || !newRec.content.trim()) {
      toast.error("Compila nome e valore del record");
      return;
    }
    const contents = newRec.content.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (contents.length === 0) return;
    startTransition(async () => {
      const r = await fetch(
        `/api/network-services/dns/zones/${encodeURIComponent(selected)}/records`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newRec.name.trim(),
            type: newRec.type,
            contents,
            ttl: Number(newRec.ttl) || 3600,
          }),
        },
      );
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(`Aggiunta record fallita: ${d.error || d.body || r.statusText}`);
        return;
      }
      toast.success("Record aggiunto");
      setNewRec({ name: "", type: "A", content: "", ttl: "3600" });
      await loadRecords(selected);
    });
  }

  function removeRecord(name: string, type: string) {
    if (!selected) return;
    if (!confirm(`Rimuovere il record ${type} ${name}?`)) return;
    startTransition(async () => {
      const r = await fetch(
        `/api/network-services/dns/zones/${encodeURIComponent(selected)}/records`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, type }),
        },
      );
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(`Rimozione fallita: ${d.error || r.statusText}`);
        return;
      }
      toast.success("Record rimosso");
      await loadRecords(selected);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">DNS autoritativo</CardTitle>
          </div>
          {active && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadZones();
                if (selected) loadRecords(selected);
              }}
              disabled={pending}
            >
              <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
        <CardDescription>
          PowerDNS — zone interne cliente e record (A/AAAA/CNAME/TXT/…). Il nome record va
          espresso come FQDN dentro la zona (es. <code>host1.cliente.lan</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && (
          <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            DNS autoritativo disabilitato. Attiva il servizio <code>dns</code> dal toggle in alto.
          </div>
        )}

        {active && error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {active && (
          <>
            {/* Zone selector + creazione */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <Label className="text-xs">Zona</Label>
                {zones.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">Nessuna zona configurata.</div>
                ) : (
                  <Select value={selected ?? undefined} onValueChange={(v) => setSelected(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona zona" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((z) => (
                        <SelectItem key={z.id} value={z.name}>
                          {z.name}{" "}
                          <span className="text-xs text-muted-foreground">({z.kind})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-end gap-2">
                  <div>
                    <Label htmlFor="newzone" className="text-xs">
                      Nuova zona
                    </Label>
                    <Input
                      id="newzone"
                      placeholder="es. cliente.lan"
                      value={newZone}
                      onChange={(e) => setNewZone(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <Button onClick={addZone} disabled={pending}>
                    <Plus className="h-4 w-4 mr-1" /> Crea zona
                  </Button>
                </div>
              )}
            </div>

            {/* Record della zona selezionata */}
            {selected && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <ChevronRight className="h-3.5 w-3.5" />
                  Record di <span className="font-mono font-medium text-foreground">{selected}</span>
                </div>
                {records.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nessun record (oltre a SOA/NS).</div>
                ) : (
                  <div className="space-y-1">
                    {records.map((rec) => (
                      <div
                        key={`${rec.name}-${rec.type}`}
                        className="flex items-center justify-between rounded border p-2 text-sm gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                            {rec.type}
                          </Badge>
                          <span className="font-mono font-medium truncate">{rec.name}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            → {rec.contents.join(", ")}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            TTL {rec.ttl}
                          </span>
                        </div>
                        {isAdmin && rec.type !== "SOA" && rec.type !== "NS" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeRecord(rec.name, rec.type)}
                            disabled={pending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Aggiungi record */}
                {isAdmin && (
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t">
                    <div className="flex-1 min-w-[160px]">
                      <Label htmlFor="rec-name" className="text-xs">
                        Nome (FQDN)
                      </Label>
                      <Input
                        id="rec-name"
                        placeholder={`host1.${selected.replace(/\.$/, "")}`}
                        value={newRec.name}
                        onChange={(e) => setNewRec({ ...newRec, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Tipo</Label>
                      <Select
                        value={newRec.type}
                        onValueChange={(v) => setNewRec({ ...newRec, type: v ?? "A" })}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECORD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <Label htmlFor="rec-content" className="text-xs">
                        Valore
                      </Label>
                      <Input
                        id="rec-content"
                        placeholder="10.0.0.5"
                        value={newRec.content}
                        onChange={(e) => setNewRec({ ...newRec, content: e.target.value })}
                      />
                    </div>
                    <div className="w-20">
                      <Label htmlFor="rec-ttl" className="text-xs">
                        TTL
                      </Label>
                      <Input
                        id="rec-ttl"
                        type="number"
                        value={newRec.ttl}
                        onChange={(e) => setNewRec({ ...newRec, ttl: e.target.value })}
                      />
                    </div>
                    <Button onClick={addRecord} disabled={pending}>
                      <Plus className="h-4 w-4 mr-1" /> Aggiungi
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
