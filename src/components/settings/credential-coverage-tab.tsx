"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { KeyRound } from "lucide-react";

/* ── Types ─────────────────────────────────────────────────── */

interface CoverageRow {
  category: string;
  hosts: number;
  withValidCredential: number;
  expectedProtocol: string;
}

/* ── Component ─────────────────────────────────────────────── */

/**
 * Vista di copertura credenziali (Fase 4b Task 4, spec §7.6): per ogni
 * categoria attribuita con un protocollo pertinente noto, quanti host hanno
 * già una credenziale validata su quel protocollo. Sola lettura — nessuna
 * azione di modifica qui, solo un indicatore per capire dove servono
 * credenziali nuove (es. "12 telecamere, 0 con credenziale ONVIF validata").
 */
export function CredentialCoverageTab() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/attribution/credential-coverage")
      .then((r) => r.json())
      .then((data: { coverage?: CoverageRow[] }) => setRows(Array.isArray(data.coverage) ? data.coverage : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Copertura credenziali per categoria</CardTitle>
        </div>
        <CardDescription>
          Per ogni categoria di dispositivo attribuita, quanti host hanno già una credenziale
          validata sul protocollo pertinente (es. SNMP per gli apparati di rete, ONVIF per le
          telecamere). Aiuta a capire dove mancano credenziali per completare l&apos;inventario.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoria</TableHead>
              <TableHead>Protocollo pertinente</TableHead>
              <TableHead className="text-right">Host</TableHead>
              <TableHead className="text-right">Con credenziale validata</TableHead>
              <TableHead className="text-right">Copertura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Caricamento…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Nessuna categoria attribuita con un protocollo di credenziali pertinente.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const pct = r.hosts > 0 ? Math.round((r.withValidCredential / r.hosts) * 100) : 0;
                const variant = pct === 100 ? "default" : pct === 0 ? "destructive" : "secondary";
                return (
                  <TableRow key={r.category}>
                    <TableCell className="font-medium text-sm">{r.category}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">{r.expectedProtocol}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.hosts}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.withValidCredential}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={variant}>{pct}%</Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
