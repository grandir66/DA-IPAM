"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DhcpReservation } from "@/lib/network-services/client";
import { dhcpField, normalizeMac } from "@/lib/network-services/dhcp-utils";

interface Props {
  isAdmin: boolean;
  active: boolean;
  refreshKey?: number;
}

const emptyForm = {
  ip_address: "",
  hw_address: "",
  hostname: "",
  subnet_id: "1",
};

export function DhcpReservationsPanel({ isAdmin, active, refreshKey }: Props) {
  const [reservations, setReservations] = useState<DhcpReservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(emptyForm);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editOriginalIp, setEditOriginalIp] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/network-services/dhcp/reservations", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "reservations fetch failed");
      setReservations(d.reservations ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load, refreshKey]);

  function openEdit(res: DhcpReservation) {
    const row = res as Record<string, unknown>;
    setEditOriginalIp(dhcpField(row, "ip-address", "ip"));
    setEditForm({
      ip_address: dhcpField(row, "ip-address", "ip"),
      hw_address: dhcpField(row, "hw-address", "mac"),
      hostname: dhcpField(row, "hostname") === "—" ? "" : dhcpField(row, "hostname"),
      subnet_id: dhcpField(row, "subnet-id", "subnet") === "—" ? "1" : dhcpField(row, "subnet-id", "subnet"),
    });
    setEditOpen(true);
  }

  function addReservation() {
    if (!form.ip_address.trim() || !form.hw_address.trim()) {
      toast.error("IP e MAC obbligatori");
      return;
    }
    startTransition(async () => {
      const r = await fetch("/api/network-services/dhcp/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: form.ip_address.trim(),
          hw_address: normalizeMac(form.hw_address),
          hostname: form.hostname.trim() || undefined,
          subnet_id: Number(form.subnet_id) || 1,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success("Reservation statica creata");
      setForm(emptyForm);
      await load();
    });
  }

  function saveEdit() {
    startTransition(async () => {
      const del = await fetch("/api/network-services/dhcp/reservations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: editOriginalIp,
          subnet_id: Number(editForm.subnet_id) || 1,
        }),
      });
      const delData = await del.json();
      if (!del.ok || delData.ok === false) {
        toast.error(`Rimozione vecchia reservation fallita: ${delData.error || del.statusText}`);
        return;
      }
      const add = await fetch("/api/network-services/dhcp/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: editForm.ip_address.trim(),
          hw_address: normalizeMac(editForm.hw_address),
          hostname: editForm.hostname.trim() || undefined,
          subnet_id: Number(editForm.subnet_id) || 1,
        }),
      });
      const addData = await add.json();
      if (!add.ok || addData.ok === false) {
        toast.error(`Aggiornamento fallito: ${addData.error || add.statusText}`);
        await load();
        return;
      }
      toast.success("Reservation aggiornata");
      setEditOpen(false);
      await load();
    });
  }

  function removeReservation(ip: string, mac: string, subnetId?: string) {
    if (!confirm(`Rimuovere reservation ${ip}?`)) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/dhcp/reservations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: ip !== "—" ? ip : undefined,
          hw_address: mac !== "—" ? normalizeMac(mac) : undefined,
          subnet_id: subnetId && subnetId !== "—" ? Number(subnetId) : 1,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success("Reservation rimossa");
      await load();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">IP statici (reservation)</CardTitle>
            <CardDescription>
              Host con indirizzo fisso — crea, modifica o elimina reservation Kea.
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
            DHCP disabilitato.
          </div>
        )}

        {active && error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {active && !error && (
          <>
            {reservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna reservation configurata.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>MAC</TableHead>
                    <TableHead>Hostname</TableHead>
                    {isAdmin && <TableHead className="w-[100px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reservations.map((res, i) => {
                    const row = res as Record<string, unknown>;
                    const ip = dhcpField(row, "ip-address", "ip");
                    const mac = dhcpField(row, "hw-address", "mac");
                    const subnet = dhcpField(row, "subnet-id", "subnet");
                    return (
                      <TableRow key={`${ip}-${i}`}>
                        <TableCell className="font-mono">{ip}</TableCell>
                        <TableCell className="font-mono">{mac}</TableCell>
                        <TableCell>{dhcpField(row, "hostname")}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openEdit(res)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeReservation(ip, mac, subnet)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {isAdmin && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Nuova reservation statica</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label className="text-xs">IP</Label>
                    <Input
                      value={form.ip_address}
                      onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">MAC</Label>
                    <Input
                      placeholder="aa:bb:cc:dd:ee:ff"
                      value={form.hw_address}
                      onChange={(e) => setForm({ ...form, hw_address: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hostname</Label>
                    <Input
                      value={form.hostname}
                      onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Subnet ID</Label>
                    <Input
                      value={form.subnet_id}
                      onChange={(e) => setForm({ ...form, subnet_id: e.target.value })}
                    />
                  </div>
                </div>
                <Button onClick={addReservation} disabled={pending}>
                  <Plus className="h-4 w-4 mr-1" /> Aggiungi statico
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica reservation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label className="text-xs">IP</Label>
              <Input
                value={editForm.ip_address}
                onChange={(e) => setEditForm({ ...editForm, ip_address: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">MAC</Label>
              <Input
                value={editForm.hw_address}
                onChange={(e) => setEditForm({ ...editForm, hw_address: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Hostname</Label>
              <Input
                value={editForm.hostname}
                onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })}
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
