"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { SOURCE_WORDS } from "@/lib/topology/edge-look";
import type { MapLink, MapNode, TopologyModel } from "@/lib/topology/model-types";
import { HypervisorSyncCard } from "./hypervisor-sync-card";
import { IgnoredLinksCard } from "./ignored-links-card";

type Model = TopologyModel & { staleDays: number };
const MAX = 200;
const FONTE: Readonly<Record<string, string>> = SOURCE_WORDS;

function Altri({ n }: { n: number }) {
  return n > MAX ? <p className="mt-2 text-sm text-muted-foreground">+ altri {n - MAX}</p> : null;
}

export function DatiClient({ isAdmin }: { isAdmin: boolean }) {
  const [m, setM] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soglia, setSoglia] = useState("");
  const [esitoSoglia, setEsitoSoglia] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetchJson<Model>("/api/topology/model", { cache: "no-store" });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setM(r.data);
    setSoglia(String(r.data.staleDays));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function salvaSoglia() {
    setEsitoSoglia(null);
    const r = await fetchJson<{ staleDays: number }>("/api/topology/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staleDays: Number(soglia) }),
    });
    setEsitoSoglia(r.ok ? `Salvata: ${r.data.staleDays} giorni` : r.message);
    if (r.ok) void load();
  }

  if (error) return <LoadError what="i dati della mappa" message={error} onRetry={load} />;
  if (!m) return <p className="text-sm text-muted-foreground">Caricamento…</p>;

  const nome = new Map(m.nodes.map((n) => [n.id, n]));
  const nn = (id: string) => nome.get(id)?.name ?? id;
  const c = m.counts;
  const numeri: Array<[string, number]> = [
    ["Apparati", c.devices], ["Nodi", c.nodes], ["Collegamenti", c.links],
    ["— fra apparati", c.deviceLinks], ["— verso host attaccati", c.attachedLinks],
    ...Object.entries(c.linksBySource).map(([k, v]) => [`— fonte ${FONTE[k] ?? k}`, v] as [string, number]),
    [`Non visti da più di ${m.staleDays} giorni`, c.staleLinks], ["Vicini non abbinati", c.unmatchedNeighbors],
    ["Apparati isolati", c.isolatedDevices], ["Host fusi negli apparati", c.fusedHosts], ["Host fusi fra loro", c.mergedHosts],
    ["Apparati senza sede", c.devicesWithoutSite], ["Sedi con testa", c.sitesWithHead],
    ["Proposte «promuovi ad apparato»", c.promoteProposals], ["Tipi sospetti", c.suspiciousTypes],
    ["«Da sistemare»: senza prove di ruolo", c.senzaProve],
  ];
  const stale: MapLink[] = m.links.filter((l) => l.stale);
  const apparati = (ids: string[]): MapNode[] =>
    ids.slice(0, MAX).map((id) => nome.get(id)).filter((n): n is MapNode => n !== undefined);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Numeri</CardTitle></CardHeader>
        <CardContent>
          <Table><TableBody>
            {numeri.map(([k, v]) => (
              <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-right tabular-nums">{v}</TableCell></TableRow>
            ))}
          </TableBody></Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sedi</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Sede</TableHead><TableHead>Testa</TableHead><TableHead className="text-right">Nodi</TableHead></TableRow></TableHeader>
            <TableBody>
              {m.sites.slice(0, MAX).map((s) => (
                <TableRow key={s.locationId}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.headNodeId ? `${nn(s.headNodeId)} — ${s.headProposed ? "proposta" : "scelta"}` : "nessuna"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.nodeIds.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Altri n={m.sites.length} />
          <div className="mt-4 flex items-end gap-2">
            <div>
              <label htmlFor="soglia" className="text-sm">Soglia «non visto» (giorni)</label>
              <Input id="soglia" type="number" min={1} max={30} value={soglia} onChange={(e) => setSoglia(e.target.value)} className="w-24" />
            </div>
            <Button variant="outline" onClick={salvaSoglia}>Salva</Button>
            {esitoSoglia && <span className="text-sm">{esitoSoglia}</span>}
          </div>
        </CardContent>
      </Card>

      <HypervisorSyncCard isAdmin={isAdmin} />

      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Proposte «promuovi ad apparato»</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>IP</TableHead><TableHead>Classificazione</TableHead><TableHead className="text-right">Collegamenti</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {m.promote.slice(0, MAX).map((p) => (
                <TableRow key={p.hostId}>
                  <TableCell>{p.name}</TableCell><TableCell className="font-mono">{p.ip}</TableCell><TableCell>{p.classification}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.links}</TableCell>
                  <TableCell><Link className="underline" href={`/objects/${p.hostId}?promote=1`}>Promuovi</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Altri n={m.promote.length} />
        </CardContent>
      </Card>

      {([["Apparati senza sede", m.withoutSite], ["Tipi sospetti", m.suspicious]] as Array<[string, string[]]>).map(([titolo, ids]) => (
        <Card key={titolo}>
          <CardHeader><CardTitle>{titolo}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>IP</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {apparati(ids).map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>{n.name}</TableCell><TableCell>{n.type}</TableCell><TableCell className="font-mono">{n.mgmtIp}</TableCell>
                    <TableCell><Link className="underline" href={`/devices/${n.refId}`}>Apri</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Altri n={ids.length} />
          </CardContent>
        </Card>
      ))}

      <IgnoredLinksCard isAdmin={isAdmin} model={m} onChanged={() => void load()} />

      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Collegamenti non visti</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Da</TableHead><TableHead>A</TableHead><TableHead>Fonte</TableHead><TableHead>Stato</TableHead></TableRow></TableHeader>
            <TableBody>
              {stale.slice(0, MAX).map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{nn(l.a)}{l.aPort ? ` (${l.aPort})` : ""}</TableCell>
                  <TableCell>{nn(l.b)}{l.bPort ? ` (${l.bPort})` : ""}</TableCell>
                  <TableCell>{FONTE[l.source] ?? l.source}</TableCell>
                  <TableCell>non visto da {l.daysUnseen} g</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Altri n={stale.length} />
        </CardContent>
      </Card>
    </div>
  );
}
