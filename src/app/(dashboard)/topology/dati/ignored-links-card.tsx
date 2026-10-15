"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchLinkOverrides, type LinkOverrideView } from "@/components/topology/map/api";
import { fetchJson } from "@/lib/fetch-json";
import { caviFra, ignoredLinkRows, ORFANA, SOLO_ADMIN_RIPRISTINA } from "@/lib/topology/ignored-links";
import type { MapLink, MapNode } from "@/lib/topology/model-types";

const MAX = 200;

/**
 * «Collegamenti ignorati» (revisione finale della fase 2b): un «Ignora» dal tasto destro nasconde un
 * cavo in tutte le mappe; qui si vede quali, e l'admin lo rimette con «Ripristina» (DELETE
 * /api/topology/links/[id]). Una correzione che non corrisponde a nessun cavo visto non toglie niente
 * (spec §13.9): la riga lo dice in parole, con «Togli la correzione» e «Scegli il cavo da ignorare…».
 * Chi non è admin vede l'elenco in sola lettura, con il motivo.
 */
export function IgnoredLinksCard({
  isAdmin,
  model,
  onChanged,
}: {
  isAdmin: boolean;
  model: {
    nodes: readonly Pick<MapNode, "id" | "name">[];
    canonical: Readonly<Record<string, string>>;
    links: readonly MapLink[];
    correzioniOrfane?: readonly number[];
  };
  /** Dopo un ripristino: i numeri della pagina cambiano. */
  onChanged: () => void;
}) {
  const [raw, setRaw] = useState<LinkOverrideView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  /** La correzione orfana per cui si sceglie un cavo, e quale cavo (nessuno di base: ignorare la linea la toglie dalla mappa). */
  const [scegli, setScegli] = useState<LinkOverrideView | null>(null);
  const [scelto, setScelto] = useState<number | null>(null);

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

  /** Toglie una correzione orfana: stessa rotta del ripristino, esito diverso (non nascondeva niente). */
  async function togli(id: number, testo: string) {
    setBusy(id);
    setEsito(null);
    const r = await fetchJson<{ ok: true }>(`/api/topology/links/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      setEsito(`Non tolta: ${r.message}`);
      return;
    }
    setEsito(`Correzione tolta: non nascondeva niente (${testo}).`);
    await load();
    onChanged();
  }

  /** Scrive la correzione sul cavo scelto e poi toglie l'orfana; se la seconda non riesce resta un'orfana in più, che non toglie niente e si vede. */
  async function sostituisci() {
    const o = scegli;
    const c = o && scelto !== null ? caviFra(model, o.a_node, o.b_node)[scelto] : undefined;
    if (!o || !c) return;
    setBusy(o.id);
    const nuova = await fetchJson<{ id: number }>("/api/topology/links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", a_node: o.a_node, a_port: c.aPort, b_node: o.b_node, b_port: c.bPort }),
    });
    if (!nuova.ok) { setBusy(null); setEsito(`Non ignorato: ${nuova.message}`); return; }
    const via = await fetchJson<{ ok: true }>(`/api/topology/links/${o.id}`, { method: "DELETE" });
    setBusy(null);
    setScegli(null);
    setEsito(via.ok ? "Cavo ignorato; la correzione di prima è tolta." : `Cavo ignorato; la correzione di prima resta (orfana): ${via.message}`);
    await load();
    onChanged();
  }

  return (
    <>
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
                    <TableHead>Da</TableHead><TableHead>Porta</TableHead><TableHead>A</TableHead><TableHead>Porta</TableHead><TableHead>Stato</TableHead>
                    <TableHead>Ignorato da</TableHead><TableHead>Quando</TableHead>{isAdmin && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, MAX).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.a}</TableCell><TableCell>{r.aPort}</TableCell>
                      <TableCell>{r.b}</TableCell><TableCell>{r.bPort}</TableCell><TableCell>{r.orfana ? ORFANA : "nasconde un cavo"}</TableCell>
                      <TableCell>{r.by}</TableCell><TableCell className="tabular-nums">{r.when}</TableCell>
                      {isAdmin && (
                        <TableCell className="space-x-1 text-right whitespace-nowrap">
                          {r.orfana ? (
                            <>
                              <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => void togli(r.id, `${r.a} ↔ ${r.b}`)}>
                                {busy === r.id ? "Tolgo…" : "Togli la correzione"}
                              </Button>
                              <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => { setScelto(null); setScegli(raw?.find((x) => x.id === r.id) ?? null); }}>
                                Scegli il cavo da ignorare…
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => void ripristina(r.id, `${r.a} ↔ ${r.b}`)}>
                              {busy === r.id ? "Ripristino…" : "Ripristina"}
                            </Button>
                          )}
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

      <Dialog open={scegli !== null} onOpenChange={(o) => { if (!o) setScegli(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Scegli il cavo da ignorare</DialogTitle></DialogHeader>
          {(() => {
            if (!scegli) return null;
            const cavi = caviFra(model, scegli.a_node, scegli.b_node);
            if (cavi.length === 0) return <p className="text-[13px]">Fra questi due oggetti oggi non c&apos;è nessun cavo visto: si può solo togliere la correzione.</p>;
            return (
              <fieldset className="space-y-1 text-[13px]">
                <legend className="mb-1">I cavi visti fra i due oggetti. Quello scelto sparisce dalle mappe; la correzione di prima si toglie.</legend>
                {cavi.map((c, k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="radio" name="cavo" checked={scelto === k} onChange={() => setScelto(k)} className="size-4" />
                    <span>{c.aPort || "porta non nota"} ↔ {c.bPort || "porta non nota"} · {c.parole}{c.linea ? " — è il cavo che oggi regge la linea sulla mappa" : ""}</span>
                  </label>
                ))}
              </fieldset>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScegli(null)}>Annulla</Button>
            <Button
              variant="destructive"
              disabled={!scegli || scelto === null || busy !== null}
              onClick={() => void sostituisci()}
            >
              Ignora questo cavo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
