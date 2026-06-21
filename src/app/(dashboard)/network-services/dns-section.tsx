"use client";

/**
 * Sezione zone DNS autoritativo (PowerDNS): forward, reverse e record.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Server, Plus, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DnsZone, DnsRecord } from "@/lib/network-services/client";
import {
  proposePtrFromARecord,
  shouldOfferPtrProposal,
  stripDot as stripDnsDot,
  type PtrProposal,
} from "@/lib/network-services/dns-ptr";

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
  const [newReverseCidr, setNewReverseCidr] = useState("");
  const [newRec, setNewRec] = useState({ name: "", type: "A", content: "", ttl: "3600" });
  const [ptrDialogOpen, setPtrDialogOpen] = useState(false);
  const [ptrProposal, setPtrProposal] = useState<PtrProposal | null>(null);
  const [createReverseZoneToo, setCreateReverseZoneToo] = useState(true);
  const [pendingRec, setPendingRec] = useState<{
    name: string;
    type: string;
    contents: string[];
    ttl: number;
  } | null>(null);

  async function fetchZoneRecords(zone: string): Promise<DnsRecord[]> {
    const z = encodeURIComponent(stripDnsDot(zone));
    const r = await fetch(`/api/network-services/dns/zones/${z}/records`, { cache: "no-store" });
    const d = await r.json();
    if (!d.ok) return [];
    return (d.records || []) as DnsRecord[];
  }

  async function postRecord(
    zone: string,
    name: string,
    type: string,
    contents: string[],
    ttl: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const r = await fetch(
      `/api/network-services/dns/zones/${encodeURIComponent(stripDnsDot(zone))}/records`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, contents, ttl }),
      },
    );
    const d = await r.json();
    if (!r.ok || d.ok === false) {
      return { ok: false, error: d.error || d.body || r.statusText };
    }
    return { ok: true };
  }

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

  function addReverseZone() {
    if (!newReverseCidr.trim()) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/dns/zones/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cidr: newReverseCidr.trim() }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(`Zona reverse fallita: ${d.error || r.statusText}`);
        return;
      }
      toast.success(`Zona reverse ${d.reverse_zone ?? ""} creata`);
      setNewReverseCidr("");
      await loadZones();
      if (d.reverse_zone) setSelected(d.reverse_zone.endsWith(".") ? d.reverse_zone : `${d.reverse_zone}.`);
    });
  }

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

    const ttl = Number(newRec.ttl) || 3600;
    const payload = {
      name: newRec.name.trim(),
      type: newRec.type,
      contents,
      ttl,
    };

    if (shouldOfferPtrProposal(newRec.type, selected, contents[0]) && contents.length === 1) {
      startTransition(async () => {
        let reverseRecords: DnsRecord[] | undefined;
        const prelim = proposePtrFromARecord({
          recordName: payload.name,
          ip: contents[0],
          forwardZone: selected,
          zones,
        });
        if (!prelim) {
          await commitRecord(payload, false);
          return;
        }
        if (prelim.reverseZoneExists) {
          reverseRecords = await fetchZoneRecords(prelim.reverseZone);
        }
        const proposal = proposePtrFromARecord({
          recordName: payload.name,
          ip: contents[0],
          forwardZone: selected,
          zones,
          reverseRecords,
        });
        if (!proposal || proposal.ptrExists) {
          if (proposal?.ptrExists) {
            toast.message("PTR già presente per questo IP — aggiungo solo il record A");
          }
          await commitRecord(payload, false);
          return;
        }
        setPendingRec(payload);
        setPtrProposal(proposal);
        setCreateReverseZoneToo(!proposal.reverseZoneExists);
        setPtrDialogOpen(true);
      });
      return;
    }

    startTransition(async () => {
      await commitRecord(payload, false);
    });
  }

  async function commitRecord(
    payload: { name: string; type: string; contents: string[]; ttl: number },
    withPtr: boolean,
    proposal?: PtrProposal | null,
  ) {
    if (!selected) return;
    const aRes = await postRecord(
      selected,
      payload.name,
      payload.type,
      payload.contents,
      payload.ttl,
    );
    if (!aRes.ok) {
      toast.error(`Aggiunta record fallita: ${aRes.error}`);
      return;
    }

    if (withPtr && proposal) {
      let reverseZone = proposal.reverseZone;
      if (!proposal.reverseZoneExists && createReverseZoneToo) {
        const rz = await fetch("/api/network-services/dns/zones/reverse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cidr: proposal.suggestedCidr }),
        });
        const rd = await rz.json();
        if (!rz.ok || rd.ok === false) {
          toast.error(`Record A creato, ma zona reverse fallita: ${rd.error || rz.statusText}`);
          await loadZones();
          await loadRecords(selected);
          resetRecForm();
          return;
        }
        if (rd.reverse_zone) {
          reverseZone = rd.reverse_zone.endsWith(".") ? rd.reverse_zone : `${rd.reverse_zone}.`;
        }
        await loadZones();
      }

      const ptrRes = await postRecord(
        reverseZone,
        proposal.ptrName,
        "PTR",
        [proposal.hostnameFqdn],
        payload.ttl,
      );
      if (!ptrRes.ok) {
        toast.error(`Record A creato, ma PTR fallito: ${ptrRes.error}`);
      } else {
        toast.success("Record A e PTR creati");
      }
    } else {
      toast.success("Record aggiunto");
    }

    resetRecForm();
    await loadRecords(selected);
  }

  function resetRecForm() {
    setNewRec({ name: "", type: "A", content: "", ttl: "3600" });
    setPtrDialogOpen(false);
    setPtrProposal(null);
    setPendingRec(null);
  }

  function confirmWithPtr() {
    if (!pendingRec || !ptrProposal) return;
    startTransition(async () => {
      await commitRecord(pendingRec, true, ptrProposal);
    });
  }

  function confirmWithoutPtr() {
    if (!pendingRec) return;
    startTransition(async () => {
      await commitRecord(pendingRec, false);
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
          PowerDNS — zone forward/reverse e record. Per i record <strong>A</strong> in zona forward
          viene proposta la creazione del PTR coerente se assente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && (
          <div className="rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm text-yellow-900 dark:text-yellow-100">
            DNS autoritativo disabilitato. Abilitalo da{" "}
            <a href="/dns?tab=panorama" className="underline font-medium">
              DNS → Panorama
            </a>
            {isAdmin ? " (toggle servizi)." : " (solo admin)."}
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
                          <span className="text-xs text-muted-foreground">
                            ({z.kind}
                            {z.name.includes("in-addr.arpa") ? " · reverse" : ""})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="newzone" className="text-xs">
                      Zona forward
                    </Label>
                    <Input
                      id="newzone"
                      placeholder="cliente.lan"
                      value={newZone}
                      onChange={(e) => setNewZone(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <Button onClick={addZone} disabled={pending}>
                    <Plus className="h-4 w-4 mr-1" /> Crea forward
                  </Button>
                  <div>
                    <Label htmlFor="reverse-cidr" className="text-xs">
                      Zona reverse (CIDR)
                    </Label>
                    <Input
                      id="reverse-cidr"
                      placeholder="192.168.99.0/24"
                      value={newReverseCidr}
                      onChange={(e) => setNewReverseCidr(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <Button variant="secondary" onClick={addReverseZone} disabled={pending}>
                    <Plus className="h-4 w-4 mr-1" /> Crea reverse
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

      <Dialog open={ptrDialogOpen} onOpenChange={(open) => !open && resetRecForm()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record PTR coerente</DialogTitle>
            <DialogDescription>
              Il record A punta a un indirizzo IPv4 senza PTR corrispondente. Vuoi registrarlo?
            </DialogDescription>
          </DialogHeader>

          {ptrProposal && pendingRec && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 font-mono text-xs">
                <p>
                  <span className="text-muted-foreground">A </span>
                  {pendingRec.name} → {ptrProposal.ip}
                </p>
                <p>
                  <span className="text-muted-foreground">PTR </span>
                  {ptrProposal.ptrName} → {ptrProposal.hostnameFqdn}
                </p>
                <p className="text-muted-foreground font-sans text-[11px] pt-1">
                  Zona reverse: {ptrProposal.reverseZone}
                </p>
              </div>

              {!ptrProposal.reverseZoneExists && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <Switch
                    id="create-reverse-zone"
                    checked={createReverseZoneToo}
                    onCheckedChange={setCreateReverseZoneToo}
                  />
                  <Label htmlFor="create-reverse-zone" className="text-xs leading-snug cursor-pointer">
                    Crea zona reverse <code>{ptrProposal.suggestedCidr}</code> (consigliato)
                  </Label>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={resetRecForm} disabled={pending}>
              Annulla
            </Button>
            <Button variant="secondary" onClick={confirmWithoutPtr} disabled={pending}>
              Solo record A
            </Button>
            <Button onClick={confirmWithPtr} disabled={pending || (!ptrProposal?.reverseZoneExists && !createReverseZoneToo)}>
              A + PTR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
