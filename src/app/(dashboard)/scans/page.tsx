"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Scan } from "lucide-react";
import { formatPortsDisplay } from "@/lib/utils";
import type { ScanHistory } from "@/types";

export default function ScansPage() {
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scans/history?limit=200")
      .then((r) => r.json())
      .then((data) => { setHistory(data); setLoading(false); });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Scansioni</h1>
        <p className="text-muted-foreground mt-1">Storico delle scansioni di rete</p>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : history.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Scan className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">Nessuna scansione eseguita</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ultime {history.length} scansioni</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Risultato</TableHead>
                  <TableHead>Porte Aperte</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell>
                      <Badge variant="outline">{scan.scan_type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{scan.status}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatPortsDisplay(scan.ports_open)}
                    </TableCell>
                    <TableCell>
                      {scan.duration_ms ? `${(scan.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(scan.timestamp).toLocaleString("it-IT")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
