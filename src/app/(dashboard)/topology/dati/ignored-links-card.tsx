"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchLinkOverrides, type LinkOverrideView } from "@/components/topology/map/api";
import { fetchJson } from "@/lib/fetch-json";
import { ignoredLinkRows, SOLO_ADMIN_RIPRISTINA } from "@/lib/topology/ignored-links";
import type { MapNode } from "@/lib/topology/model-types";

const MAX = 200;

/**
 * «Collegamenti ignorati» (revisione finale della fase 2b): un «Ignora» dal tasto destro nasconde una
 * linea in tutte le mappe; qui si vede quali, e l'admin la rimette con «Ripristina» (DELETE
 * /api/topology/links/[id]). Chi non è admin vede l'elenco in sola lettura, con il motivo.
 */
export function IgnoredLinksCard({
  isAdmin,
  model,
  onChanged,
}: {
  isAdmin: boolean;
  model: { nodes: readonly Pick<MapNode, "id" | "name">[]; canonical: Readonly<Record<string, string>> };
  /** Dopo un ripristino: i numeri della pagina cambiano. */
  onChanged: () => void;
}) {
  const [raw, setRaw] = useState<LinkOverrideView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [esito, setEsito] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetchLinkOverrides();
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setRaw(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // I nomi si leggono dal modello della pagina a ogni resa: dopo un ripristino il modello si ricarica.
  const rows = raw ? ignoredLinkRows(raw, model) : null;

  async function ripristina(id: number, testo: string) {
    setBusy(id);
    setEsito(null);
    const r = await fetchJson<{ ok: true }>(`/api/topology/links/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      setEsito(`Non ripristinato: ${r.message}`);
      return;
    }
    setEsito(`Ripristinato: ${testo} torna sulla mappa se le letture lo vedono.`);
    await load();
    onChanged();
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Collegamenti ignorati</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <LoadError what="i collegamenti ignorati" message={error} onRetry={load} />
        ) : !rows ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun collegamento ignorato: tutte le linee viste dalle letture sono sulla mappa.</p>
        ) : (
          <>
            {!isAdmin && <p className="text-sm text-muted-foreground">{SOLO_ADMIN_RIPRISTINA}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Da</TableHead><TableHead>Porta</TableHead><TableHead>A</TableHead><TableHead>Porta</TableHead>
                  <TableHead>Ignorato da</TableHead><TableHead>Quando</TableHead>{isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, MAX).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.a}</TableCell><TableCell>{r.aPort}</TableCell>
                    <TableCell>{r.b}</TableCell><TableCell>{r.bPort}</TableCell>
                    <TableCell>{r.by}</TableCell><TableCell className="tabular-nums">{r.when}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => void ripristina(r.id, `${r.a} ↔ ${r.b}`)}>
                          {busy === r.id ? "Ripristino…" : "Ripristina"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > MAX && <p className="text-sm text-muted-foreground">+ altri {rows.length - MAX}</p>}
          </>
        )}
        {esito && <p className="text-sm" role="status">{esito}</p>}
      </CardContent>
    </Card>
  );
}
