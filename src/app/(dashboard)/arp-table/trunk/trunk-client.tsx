"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { TrunkOsservazioneRiga, TrunkReteMatrice, TrunkVlanRiga } from "@/lib/trunk/sensore-trunk";

const PAGINA = 100;

interface Dati {
  attiva: boolean;
  vlan: TrunkVlanRiga[];
  righe: TrunkOsservazioneRiga[];
  totale: number;
  retiIpam: string[];
  matrice: { giorni: string[]; reti: TrunkReteMatrice[] };
}

export function TrunkClient({ iniziale }: { iniziale: Dati }) {
  const router = useRouter();
  const attiva = iniziale.attiva;
  const [righe, setRighe] = useState(iniziale.righe);
  const [totale, setTotale] = useState(iniziale.totale);
  const [vid, setVid] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [retiIpam, setRetiIpam] = useState<string[]>(iniziale.retiIpam);

  const portaInIpam = async (vid: number, cidr: string, gateway: string | null | undefined) => {
    const r = await fetchJson<{ id: number }>("/api/trunk/rete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vid, cidr, gateway: gateway ?? null }),
    });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setRetiIpam((x) => [...x, cidr]);
    toast.success(`Rete ${cidr} creata in DA-IPAM`);
    router.refresh();
  };

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

  const giroArp = async (vid: number, cidr: string) => {
    setInCorso(true);
    try {
      const r = await fetchJson<{ id: number; fonte: string }>("/api/trunk/giro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid, cidr }),
      });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(`Giro ARP avviato su ${cidr}: i risultati compaiono al prossimo giro di lettura`);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Sensore trunk {attiva ? <Badge variant="secondary">acceso</Badge> : <Badge variant="outline">spento</Badge>}</CardTitle>
          <Button size="sm" variant="outline" render={<Link href="/settings/opzioni#modulo.sensore_trunk" />}>
            {attiva ? "Cambia in Opzioni" : "Accendi in Opzioni"}
          </Button>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {attiva
            ? "Acceso: a ogni giro ARP si copiano le VLAN e gli IP nuovi visti in ascolto dal sensore (sulla stessa macchina o sullo Scanner-Edge). Il giro ARP su una rete parte solo se lo chiedi."
            : "Spento: niente viene letto. Si accende da Impostazioni › Opzioni, voce «Sensore trunk»."}
        </CardContent>
      </Card>

      <MatriceReti
        matrice={iniziale.matrice}
        retiIpam={retiIpam}
        inCorso={inCorso || !attiva}
        onGiro={(vid, cidr) => void giroArp(vid, cidr)}
        onPorta={(vid, cidr, gw) => void portaInIpam(vid, cidr, gw)}
      />

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
                  <TableHead>Subnet dedotte</TableHead>
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
                    <TableCell className="font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                      {v.reti.length === 0 && "—"}
                      {v.reti.map((r) => (
                        <div key={r.cidr} className="flex items-center gap-2 py-0.5">
                          <span>
                            {r.cidr}
                            {r.gateway_ip && (r.fonte === "dhcp" ? ` → gw ${r.gateway_ip}` : ` · IP più cercato ${r.gateway_ip}`)}
                          </span>
                          {retiIpam.includes(r.cidr) ? (
                            <Badge variant="secondary">in DA-IPAM</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => void portaInIpam(v.vid, r.cidr, r.fonte === "dhcp" ? r.gateway_ip : null)}>
                              Porta in DA-IPAM
                            </Button>
                          )}
                        </div>
                      ))}
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

function MatriceReti({
  matrice, retiIpam, inCorso, onGiro, onPorta,
}: {
  matrice: { giorni: string[]; reti: TrunkReteMatrice[] };
  retiIpam: string[];
  inCorso: boolean;
  onGiro: (vid: number, cidr: string) => void;
  onPorta: (vid: number, cidr: string, gateway: string | null) => void;
}) {
  const [aperta, setAperta] = useState<string | null>(null);
  const massimo = Math.max(1, ...matrice.reti.flatMap((r) => r.serie.map((g) => g.noti)));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reti nel tempo ({matrice.reti.length})</CardTitle>
        <p className="text-muted-foreground text-sm">
          Ogni riga è una subnet vista in ascolto; ogni casella un giorno. Il numero sono gli IP conosciuti fino a quel
          giorno, il colore quanti erano attivi, il «+» quelli nuovi. Clic sulla riga per l&apos;elenco degli IP.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {matrice.reti.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nessuna subnet dedotta finora.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VLAN</TableHead>
                <TableHead>Subnet</TableHead>
                {matrice.giorni.map((g) => (
                  <TableHead key={g} className="text-center text-xs">{g.slice(8, 10)}/{g.slice(5, 7)}</TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrice.reti.map((r) => {
                const chiave = `${r.vid}-${r.cidr}`;
                const gw = r.fonte === "dhcp" ? r.gateway_ip : null;
                return [
                  <TableRow key={chiave} className="cursor-pointer" onClick={() => setAperta(aperta === chiave ? null : chiave)}>
                    <TableCell className="font-mono">{r.vid === 0 ? "nativa" : r.vid}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.cidr}
                      <div className="text-muted-foreground">
                        {r.ip.length} IP
                        {r.gateway_ip && (r.fonte === "dhcp" ? ` · gw ${r.gateway_ip}` : ` · IP più cercato ${r.gateway_ip}`)}
                      </div>
                    </TableCell>
                    {r.serie.map((g) => (
                      <TableCell
                        key={g.giorno}
                        className="text-center font-mono text-xs"
                        style={g.attivi ? { backgroundColor: `rgba(0, 167, 231, ${0.15 + 0.6 * (g.attivi / massimo)})` } : undefined}
                        title={`${g.giorno}: ${g.noti} noti, ${g.attivi} attivi, ${g.nuovi} nuovi`}
                      >
                        {g.noti || ""}
                        {g.nuovi > 0 && <div className="text-xs font-semibold">+{g.nuovi}</div>}
                      </TableCell>
                    ))}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={inCorso} onClick={() => onGiro(r.vid, r.cidr)}>
                          Giro ARP
                        </Button>
                        {retiIpam.includes(r.cidr) ? (
                          <Badge variant="secondary">in DA-IPAM</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => onPorta(r.vid, r.cidr, gw)}>
                            Porta in DA-IPAM
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>,
                  aperta === chiave && (
                    <TableRow key={`${chiave}-ip`}>
                      <TableCell colSpan={matrice.giorni.length + 3}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>IP</TableHead>
                              <TableHead>MAC</TableHead>
                              <TableHead>Nome</TableHead>
                              <TableHead>Come</TableHead>
                              <TableHead>Prima vista</TableHead>
                              <TableHead>Ultima vista</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.ip.map((i) => (
                              <TableRow key={i.ip}>
                                <TableCell className="font-mono">{i.ip}</TableCell>
                                <TableCell className="font-mono">{i.mac}</TableCell>
                                <TableCell>{i.nome ?? "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {[i.passivo ? "ascolto" : null, i.attivo ? "giro ARP" : null].filter(Boolean).join(" + ")}
                                </TableCell>
                                <TableCell className="text-xs">{i.prima_vista}</TableCell>
                                <TableCell className="text-xs">{i.ultima_vista}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
