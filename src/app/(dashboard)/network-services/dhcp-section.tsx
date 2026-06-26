"use client";

/**
 * Sezione "DHCP" (Kea) della pagina Network Services — SOLO LETTURA.
 * Mostra lease attivi e reservation statiche. Il bridge non espone write su Kea.
 */
import { useCallback, useEffect, useState } from "react";
import { Wifi, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DhcpLease, DhcpReservation } from "@/lib/network-services/client";

interface Props {
  /** true se kea-dhcp4 è attivo (status.services.dhcp.active === "active"). */
  active: boolean;
}

/** Legge un campo Kea tollerando varianti di naming. */
function field(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "—";
}

export function DhcpSection({ active }: Props) {
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [reservations, setReservations] = useState<DhcpReservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/network-services/dhcp", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "dhcp fetch failed");
      setLeases(d.leases?.leases ?? []);
      setReservations(d.reservations?.reservations ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">DHCP</CardTitle>
            <Badge variant="secondary" className="text-[10px]">
              sola lettura
            </Badge>
          </div>
          {active && (
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
        <CardDescription>
          Kea DHCP4 — lease attivi e reservation statiche. La gestione delle reservation
          avviene tramite DA-IPAM; qui è una vista di sola lettura del server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && (
          <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            DHCP disabilitato. Attiva il servizio <code>dhcp</code> dal toggle in alto.
          </div>
        )}

        {active && error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {active && !error && (
          <>
            <div>
              <div className="text-sm font-medium mb-1">
                Lease attivi <span className="text-muted-foreground">({leases.length})</span>
              </div>
              {leases.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nessun lease attivo.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Subnet</TableHead>
                      <TableHead>Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leases.map((l, i) => {
                      const row = l as Record<string, unknown>;
                      return (
                        <TableRow key={`${field(row, "ip-address", "ip")}-${i}`}>
                          <TableCell className="font-mono">{field(row, "ip-address", "ip")}</TableCell>
                          <TableCell className="font-mono">{field(row, "hw-address", "mac")}</TableCell>
                          <TableCell>{field(row, "hostname")}</TableCell>
                          <TableCell>{field(row, "subnet-id", "subnet")}</TableCell>
                          <TableCell>{field(row, "state")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-1">
                Reservation statiche{" "}
                <span className="text-muted-foreground">({reservations.length})</span>
              </div>
              {reservations.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nessuna reservation configurata.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Hostname</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((res, i) => {
                      const row = res as Record<string, unknown>;
                      return (
                        <TableRow key={`${field(row, "ip-address", "ip")}-${i}`}>
                          <TableCell className="font-mono">{field(row, "ip-address", "ip")}</TableCell>
                          <TableCell className="font-mono">{field(row, "hw-address", "mac")}</TableCell>
                          <TableCell>{field(row, "hostname")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
