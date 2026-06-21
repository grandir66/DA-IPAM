"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DhcpLease } from "@/lib/network-services/client";
import { dhcpField, normalizeMac } from "@/lib/network-services/dhcp-utils";

interface Props {
  isAdmin: boolean;
  active: boolean;
  onReservationCreated?: () => void;
}

export function DhcpLeasesPanel({ isAdmin, active, onReservationCreated }: Props) {
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/network-services/dhcp", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "dhcp fetch failed");
      setLeases(d.leases?.leases ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  function convertToStatic(lease: DhcpLease) {
    const row = lease as Record<string, unknown>;
    const ip = dhcpField(row, "ip-address", "ip");
    const mac = normalizeMac(dhcpField(row, "hw-address", "mac"));
    const hostname = dhcpField(row, "hostname");
    const subnetIdRaw = dhcpField(row, "subnet-id", "subnet");
    const subnetId = subnetIdRaw !== "—" ? Number(subnetIdRaw) : undefined;

    if (ip === "—" || mac === "—") {
      toast.error("Lease incompleto (IP o MAC mancante)");
      return;
    }
    if (!confirm(`Convertire ${ip} (${mac}) in reservation statica?`)) return;

    startTransition(async () => {
      const r = await fetch("/api/network-services/dhcp/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: ip,
          hw_address: mac,
          hostname: hostname !== "—" ? hostname : undefined,
          subnet_id: Number.isFinite(subnetId) ? subnetId : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) {
        toast.error(typeof d.error === "string" ? d.error : d.detail || r.statusText);
        return;
      }
      toast.success(`Reservation statica creata per ${ip}`);
      onReservationCreated?.();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Lease dinamici</CardTitle>
            <CardDescription>
              Client con IP assegnato dinamicamente — converti in statico con un click.
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
            {leases.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun lease attivo.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>MAC</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Subnet</TableHead>
                    <TableHead>Stato</TableHead>
                    {isAdmin && <TableHead className="w-[120px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leases.map((l, i) => {
                    const row = l as Record<string, unknown>;
                    return (
                      <TableRow key={`${dhcpField(row, "ip-address", "ip")}-${i}`}>
                        <TableCell className="font-mono">{dhcpField(row, "ip-address", "ip")}</TableCell>
                        <TableCell className="font-mono">{dhcpField(row, "hw-address", "mac")}</TableCell>
                        <TableCell>{dhcpField(row, "hostname")}</TableCell>
                        <TableCell>{dhcpField(row, "subnet-id", "subnet")}</TableCell>
                        <TableCell>{dhcpField(row, "state")}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => convertToStatic(l)}
                              disabled={pending}
                            >
                              <Pin className="h-3.5 w-3.5 mr-1" />
                              Statico
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
