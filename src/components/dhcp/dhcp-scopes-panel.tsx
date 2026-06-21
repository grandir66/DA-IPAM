"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DhcpSubnet } from "@/lib/network-services/client";
import { optionDataValue, parsePoolRange } from "@/lib/network-services/dhcp-utils";

interface Props {
  isAdmin: boolean;
  active: boolean;
}

const emptyForm = {
  id: "1",
  subnet: "",
  pool_start: "",
  pool_end: "",
  routers: "",
  domain_name_servers: "",
  domain_name: "",
  valid_lifetime: "86400",
};

export function DhcpScopesPanel({ isAdmin, active }: Props) {
  const [subnets, setSubnets] = useState<DhcpSubnet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(emptyForm);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/network-services/dhcp/subnets", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "subnets fetch failed");
      setSubnets(d.subnets ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  function openEdit(s: DhcpSubnet) {
    const pool = parsePoolRange(s);
    setEditId(s.id);
    setEditForm({
      id: String(s.id),
      subnet: s.subnet,
      pool_start: pool.start,
      pool_end: pool.end,
      routers: optionDataValue(s, "routers"),
      domain_name_servers: optionDataValue(s, "domain-name-servers"),
      domain_name: optionDataValue(s, "domain-name"),
      valid_lifetime: String(s["valid-lifetime"] ?? 86400),
    });
    setEditOpen(true);
  }

  function addScope() {
    if (!form.subnet.trim() || !form.pool_start.trim() || !form.pool_end.trim()) {
      toast.error("Compila subnet e range pool");
      return;
    }
    startTransition(async () => {
      const r = await fetch("/api/network-services/dhcp/subnets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(form.id) || 1,
          subnet: form.subnet.trim(),
          pool_start: form.pool_start.trim(),
          pool_end: form.pool_end.trim(),
          routers: form.routers.trim() || undefined,
          domain_name_servers: form.domain_name_servers.trim() || undefined,
          domain_name: form.domain_name.trim() || undefined,
          "valid-lifetime": Number(form.valid_lifetime) || 86400,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success("Scope DHCP creato");
      setForm(emptyForm);
      await load();
    });
  }

  function saveEdit() {
    if (editId == null) return;
    startTransition(async () => {
      const r = await fetch(`/api/network-services/dhcp/subnets/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subnet: editForm.subnet.trim(),
          pool_start: editForm.pool_start.trim(),
          pool_end: editForm.pool_end.trim(),
          routers: editForm.routers.trim() || undefined,
          domain_name_servers: editForm.domain_name_servers.trim() || undefined,
          domain_name: editForm.domain_name.trim() || undefined,
          "valid-lifetime": Number(editForm.valid_lifetime) || 86400,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success("Scope aggiornato");
      setEditOpen(false);
      await load();
    });
  }

  function removeScope(id: number) {
    if (!confirm(`Eliminare lo scope DHCP id ${id}?`)) return;
    startTransition(async () => {
      const r = await fetch(`/api/network-services/dhcp/subnets/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success("Scope eliminato");
      await load();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Scope e parametri DHCP</CardTitle>
            <CardDescription>
              Subnet Kea, range pool, gateway, DNS e lifetime lease.
            </CardDescription>
          </div>
          {active && (
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={pending}>
              <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && (
          <div className="rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm">
            DHCP disabilitato. Abilitalo da{" "}
            <a href="/dhcp?tab=panorama" className="underline font-medium">
              DHCP → Panorama
            </a>
            .
          </div>
        )}

        {active && error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {active && (
          <>
            {subnets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuno scope configurato.</p>
            ) : (
              <div className="space-y-2">
                {subnets.map((s) => {
                  const pool = parsePoolRange(s);
                  return (
                    <div key={s.id} className="rounded border p-3 text-sm space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">id {s.id}</Badge>
                          <span className="font-mono font-medium">{s.subnet}</span>
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removeScope(s.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <p className="text-muted-foreground">
                        Pool: {pool.start || "—"} → {pool.end || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Gateway: {optionDataValue(s, "routers") || "—"} · DNS:{" "}
                        {optionDataValue(s, "domain-name-servers") || "—"} · TTL:{" "}
                        {s["valid-lifetime"] ?? "—"}s
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {isAdmin && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Nuovo scope</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label className="text-xs">Subnet ID</Label>
                    <Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Subnet (CIDR)</Label>
                    <Input
                      placeholder="192.168.99.0/24"
                      value={form.subnet}
                      onChange={(e) => setForm({ ...form, subnet: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Valid lifetime (s)</Label>
                    <Input
                      value={form.valid_lifetime}
                      onChange={(e) => setForm({ ...form, valid_lifetime: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Pool inizio</Label>
                    <Input
                      placeholder="192.168.99.100"
                      value={form.pool_start}
                      onChange={(e) => setForm({ ...form, pool_start: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Pool fine</Label>
                    <Input
                      placeholder="192.168.99.200"
                      value={form.pool_end}
                      onChange={(e) => setForm({ ...form, pool_end: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Gateway (routers)</Label>
                    <Input
                      value={form.routers}
                      onChange={(e) => setForm({ ...form, routers: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">DNS server</Label>
                    <Input
                      placeholder="192.168.99.53"
                      value={form.domain_name_servers}
                      onChange={(e) => setForm({ ...form, domain_name_servers: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Dominio</Label>
                    <Input
                      value={form.domain_name}
                      onChange={(e) => setForm({ ...form, domain_name: e.target.value })}
                    />
                  </div>
                </div>
                <Button onClick={addScope} disabled={pending}>
                  <Plus className="h-4 w-4 mr-1" /> Crea scope
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifica scope {editId}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label className="text-xs">Subnet (CIDR)</Label>
              <Input
                value={editForm.subnet}
                onChange={(e) => setEditForm({ ...editForm, subnet: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Pool inizio</Label>
                <Input
                  value={editForm.pool_start}
                  onChange={(e) => setEditForm({ ...editForm, pool_start: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Pool fine</Label>
                <Input
                  value={editForm.pool_end}
                  onChange={(e) => setEditForm({ ...editForm, pool_end: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Gateway</Label>
              <Input
                value={editForm.routers}
                onChange={(e) => setEditForm({ ...editForm, routers: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">DNS</Label>
              <Input
                value={editForm.domain_name_servers}
                onChange={(e) => setEditForm({ ...editForm, domain_name_servers: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Annulla
            </Button>
            <Button onClick={saveEdit} disabled={pending}>
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
