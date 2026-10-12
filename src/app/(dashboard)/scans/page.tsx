"use client";
import { parseDbDate } from "@/lib/db-date";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";

import { useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  // Un 401/500 non è "nessuna scansione" (UI-7): si mostra l'errore.
  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchJson<ScanHistory[]>("/api/scans/history?limit=200");
    if (r.ok) {
      setHistory(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } else {
      setError(r.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Scansioni</h1>
        <p className="text-muted-foreground mt-1">Storico delle scansioni di rete</p>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : error ? (
        <LoadError what="le scansioni" message={error} onRetry={() => void load()} />
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
                      {parseDbDate(scan.timestamp).toLocaleString("it-IT")}
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
