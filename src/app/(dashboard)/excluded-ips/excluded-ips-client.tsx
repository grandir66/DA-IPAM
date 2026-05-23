"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Ban, RotateCcw, Loader2 } from "lucide-react";
import type { ExcludedIpWithNetwork } from "@/types";

export function ExcludedIpsClient() {
  const [items, setItems] = useState<ExcludedIpWithNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/excluded-ips");
      const data = await res.json();
      setItems(data.excluded_ips ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (networkId: number, ip: string) => {
    const key = `${networkId}:${ip}`;
    if (!confirm(`Rimuovere ${ip} dalla blacklist? Le prossime scansioni potranno ricreare l'host.`)) return;
    setRemoving(key);
    try {
      const res = await fetch(`/api/networks/${networkId}/excluded-ips`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      if (res.ok) {
        setItems((cur) => cur.filter((it) => !(it.network_id === networkId && it.ip === ip)));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Errore durante la rimozione");
      }
    } finally {
      setRemoving(null);
    }
  };

  const reasonLabel = (reason: string | null): string => {
    if (!reason) return "—";
    const map: Record<string, string> = {
      host_deleted: "Eliminato manualmente",
      host_bulk_deleted: "Eliminato in massa",
      manual: "Aggiunto manualmente",
    };
    return map[reason] ?? reason;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            IP esclusi (tombstone)
          </CardTitle>
          <CardDescription>
            Quando elimini un host, l&apos;IP entra in questa lista per impedire che fonti passive
            (ARP del router, lease DHCP, sync Active Directory) lo ricreino silenziosamente.
            I probe attivi (ICMP) che confermano un device fisicamente presente con lo stesso IP
            rimuovono automaticamente l&apos;esclusione.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento...
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Nessun IP escluso. Quando elimini un host la sua coppia (rete, IP) finirà qui.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rete</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Eliminato da</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-32">Azione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const key = `${it.network_id}:${it.ip}`;
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">
                        {it.network_name}
                        <div className="text-xs text-muted-foreground font-mono">{it.network_cidr}</div>
                      </TableCell>
                      <TableCell className="font-mono">{it.ip}</TableCell>
                      <TableCell>{reasonLabel(it.reason)}</TableCell>
                      <TableCell>{it.excluded_by ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(it.excluded_at).toLocaleString("it-IT")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={removing === key}
                          onClick={() => handleRemove(it.network_id, it.ip)}
                        >
                          {removing === key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              Rimuovi
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
