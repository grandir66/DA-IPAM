"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { TrunkOsservazioneRiga, TrunkVlanRiga } from "@/lib/trunk/sensore-trunk";

const PAGINA = 100;

interface Dati {
  attiva: boolean;
  vlan: TrunkVlanRiga[];
  righe: TrunkOsservazioneRiga[];
  totale: number;
}

export function TrunkClient({ iniziale }: { iniziale: Dati }) {
  const router = useRouter();
  const [attiva, setAttiva] = useState(iniziale.attiva);
  const [righe, setRighe] = useState(iniziale.righe);
  const [totale, setTotale] = useState(iniziale.totale);
  const [vid, setVid] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async (v: number | null, testo: string, off: number) => {
    const p = new URLSearchParams({ limit: String(PAGINA), offset: String(off) });
    if (v != null) p.set("vid", String(v));
    if (testo.trim()) p.set("q", testo.trim());
    const r = await fetchJson<{ osservazioni: TrunkOsservazioneRiga[]; totale: number }>(`/api/trunk?${p.toString()}`);
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setRighe(r.data.osservazioni);
    setTotale(r.data.totale);
    setVid(v);
    setOffset(off);
  }, []);

  const cambiaLettura = async () => {
    setInCorso(true);
    try {
      const r = await fetchJson<{ attiva: boolean; osservazioni?: number; nota?: string; error?: string }>("/api/trunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attiva: !attiva }),
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setAttiva(r.data.attiva);
      if (r.data.attiva) {
        toast.success(r.data.nota ? `Lettura accesa: ${r.data.nota}` : `Lettura accesa: ${r.data.osservazioni ?? 0} osservazioni`);
      } else {
        toast.success("Lettura spenta");
      }
      router.refresh();
      await carica(vid, q, 0);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Lettura dal sensore trunk</CardTitle>
          <Button size="sm" variant={attiva ? "outline" : "default"} disabled={inCorso} onClick={cambiaLettura}>
            {attiva ? "Spegni la lettura" : "Accendi la lettura"}
          </Button>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {attiva
            ? "Accesa: a ogni giro ARP si copiano le VLAN e i MAC nuovi visti dal sensore (socket locale o Scanner-Edge)."
            : "Spenta: niente viene letto. Accendila se sull'appliance o sullo Scanner-Edge c'è il sensore trunk."}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">VLAN ({iniziale.vlan.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {iniziale.vlan.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nessuna VLAN letta finora.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VLAN</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Subnet / gateway dedotti</TableHead>
                  <TableHead>Ultima vista</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {iniziale.vlan.map((v) => (
                  <TableRow key={v.vid} className="cursor-pointer" onClick={() => void carica(v.vid, q, 0)}>
                    <TableCell className="font-mono">{v.vid === 0 ? "nativa" : v.vid}</TableCell>
                    <TableCell>
                      {v.vista && v.dichiarata && <Badge variant="secondary">vista e dichiarata</Badge>}
                      {v.vista && !v.dichiarata && <Badge>vista, non dichiarata</Badge>}
                      {!v.vista && v.dichiarata && <Badge variant="destructive">dichiarata, mai vista</Badge>}
                    </TableCell>
                    <TableCell>{v.mac}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.reti.map((r) => `${r.cidr}${r.gateway_ip ? ` → ${r.gateway_ip}` : ""}`).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{v.ultima_vista ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            MAC e IP {vid != null ? `della VLAN ${vid === 0 ? "nativa" : vid}` : ""} ({totale})
          </CardTitle>
          <div className="flex items-center gap-2">
            {vid != null && (
              <Button size="sm" variant="outline" onClick={() => void carica(null, q, 0)}>
                Tutte le VLAN
              </Button>
            )}
            <Input
              className="w-56"
              placeholder="Cerca IP, MAC, nome"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void carica(vid, q, 0);
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {errore && <LoadError what="le osservazioni del trunk" message={errore} onRetry={() => void carica(vid, q, offset)} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VLAN</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Come</TableHead>
                <TableHead>Ultima vista</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.vid === 0 ? "nativa" : r.vid}</TableCell>
                  <TableCell className="font-mono">{r.ip || "—"}</TableCell>
                  <TableCell className="font-mono">{r.mac_display}</TableCell>
                  <TableCell>{r.nome ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {[r.passivo ? "ascolto" : null, r.attivo ? "giro ARP" : null].filter(Boolean).join(" + ")}
                  </TableCell>
                  <TableCell className="text-xs">{r.ultima_vista}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => void carica(vid, q, Math.max(offset - PAGINA, 0))}>
              Precedenti
            </Button>
            <span className="text-muted-foreground">
              {totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, totale)}`} di {totale}
            </span>
            <Button size="sm" variant="outline" disabled={offset + PAGINA >= totale} onClick={() => void carica(vid, q, offset + PAGINA)}>
              Successivi
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
