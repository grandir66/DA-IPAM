"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { TrunkIpVisto, TrunkMetodo, TrunkOsservazioneRiga, TrunkReteMatrice, TrunkVlanRiga } from "@/lib/trunk/sensore-trunk";

const PAGINA = 100;

interface Riepilogo {
  vlan: number;
  osservazioni: number;
  aggiornato: string | null;
  ip: number;
  mac: number;
  soloAscolto: number;
  soloGiro: number;
}

interface Dati {
  attiva: boolean;
  vlan: TrunkVlanRiga[];
  righe: TrunkOsservazioneRiga[];
  totale: number;
  retiIpam: string[];
  matrice: { giorni: string[]; reti: TrunkReteMatrice[] };
  riepilogo: Riepilogo;
}

const METODI: Array<{ id: TrunkMetodo | null; etichetta: string }> = [
  { id: null, etichetta: "Tutti" },
  { id: "ascolto", etichetta: "Solo in ascolto" },
  { id: "giro", etichetta: "Silenziosi (solo giro ARP)" },
  { id: "entrambi", etichetta: "Ascolto + giro ARP" },
];

const nomeVlan = (vid: number) => (vid === 0 ? "nativa" : String(vid));

function comeTrovato(passivo: number, attivo: number): string {
  return [passivo ? "ascolto" : null, attivo ? "giro ARP" : null].filter(Boolean).join(" + ") || "—";
}

/** Gli indirizzi di un /24 (i primi tre ottetti) dentro una subnet, con quelli visti. */
function blocchi24(rete: TrunkReteMatrice): string[] {
  const visti = new Set(rete.ip.map((i) => i.ip.split(".").slice(0, 3).join(".")));
  const base = rete.cidr.split("/")[0].split(".").slice(0, 3).join(".");
  if (visti.size === 0) visti.add(base);
  return [...visti].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const n = (x: string) => x.split(".").reduce((a, p) => a * 256 + (Number(p) || 0), 0);
  const maschera = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits);
  return Math.floor(n(ip) / 2 ** (32 - bits)) === Math.floor(n(base) / 2 ** (32 - bits)) && maschera >= 0;
}

export function TrunkClient({ iniziale }: { iniziale: Dati }) {
  const router = useRouter();
  const attiva = iniziale.attiva;
  const r = iniziale.riepilogo;
  const [righe, setRighe] = useState(iniziale.righe);
  const [totale, setTotale] = useState(iniziale.totale);
  const [vid, setVid] = useState<number | null>(null);
  const [metodo, setMetodo] = useState<TrunkMetodo | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [retiIpam, setRetiIpam] = useState<string[]>(iniziale.retiIpam);
  const [scelta, setScelta] = useState<string | null>(
    iniziale.matrice.reti[0] ? `${iniziale.matrice.reti[0].vid}-${iniziale.matrice.reti[0].cidr}` : null,
  );

  const retiFiltrate = useMemo(
    () => iniziale.matrice.reti.filter((x) => vid == null || x.vid === vid),
    [iniziale.matrice.reti, vid],
  );
  const reteScelta = iniziale.matrice.reti.find((x) => `${x.vid}-${x.cidr}` === scelta) ?? retiFiltrate[0] ?? null;

  const portaInIpam = async (v: number, cidr: string, gateway: string | null | undefined) => {
    const res = await fetchJson<{ id: number }>("/api/trunk/rete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vid: v, cidr, gateway: gateway ?? null }),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRetiIpam((x) => [...x, cidr]);
    toast.success(`Rete ${cidr} creata in DA-IPAM`);
    router.refresh();
  };

  const carica = useCallback(async (v: number | null, m: TrunkMetodo | null, testo: string, off: number) => {
    const p = new URLSearchParams({ limit: String(PAGINA), offset: String(off) });
    if (v != null) p.set("vid", String(v));
    if (m) p.set("metodo", m);
    if (testo.trim()) p.set("q", testo.trim());
    const res = await fetchJson<{ osservazioni: TrunkOsservazioneRiga[]; totale: number }>(`/api/trunk?${p.toString()}`);
    if (!res.ok) {
      setErrore(res.message);
      return;
    }
    setErrore(null);
    setRighe(res.data.osservazioni);
    setTotale(res.data.totale);
    setVid(v);
    setMetodo(m);
    setOffset(off);
  }, []);

  const giroArp = async (v: number, cidr: string) => {
    setInCorso(true);
    try {
      const res = await fetchJson<{ id: number; fonte: string }>("/api/trunk/giro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: v, cidr }),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Giro ARP avviato su ${cidr}: i risultati compaiono al prossimo giro di lettura`);
    } finally {
      setInCorso(false);
    }
  };

  const scegliVlan = (v: number | null) => {
    setVid(v);
    const prima = iniziale.matrice.reti.find((x) => v == null || x.vid === v);
    setScelta(prima ? `${prima.vid}-${prima.cidr}` : null);
    void carica(v, metodo, q, 0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", attiva ? "bg-[#00A7E7]" : "bg-muted-foreground/40")} />
          <span className="font-medium">Sensore trunk {attiva ? "acceso" : "spento"}</span>
          <span className="text-muted-foreground">
            {attiva
              ? `· solo ascolto; ultima lettura ${r.aggiornato ? r.aggiornato.replace("T", " ").slice(0, 16) : "mai"}`
              : "· si accende da Impostazioni › Opzioni"}
          </span>
        </div>
        <Button size="sm" variant="outline" render={<Link href="/settings/opzioni#modulo.sensore_trunk" />}>
          {attiva ? "Cambia in Opzioni" : "Accendi in Opzioni"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titolo="VLAN viste sul trunk" valore={r.vlan} nota={`${iniziale.vlan.filter((v) => v.vista && !v.dichiarata).length} non dichiarate`} />
        <Kpi titolo="Subnet dedotte" valore={iniziale.matrice.reti.length} nota={`${iniziale.matrice.reti.filter((x) => retiIpam.includes(x.cidr)).length} già in DA-IPAM`} />
        <Kpi titolo="Indirizzi IP" valore={r.ip} nota={`${r.soloAscolto} solo in ascolto · ${r.soloGiro} silenziosi`} />
        <Kpi titolo="MAC unici" valore={r.mac} nota="senza leggere il router" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">VLAN:</span>
        <Button size="sm" variant={vid == null ? "default" : "outline"} onClick={() => scegliVlan(null)}>
          Tutte
        </Button>
        {iniziale.vlan.map((v) => (
          <Button
            key={v.vid}
            size="sm"
            variant={vid === v.vid ? "default" : "outline"}
            onClick={() => scegliVlan(v.vid)}
            title={v.vista ? (v.dichiarata ? "vista e dichiarata" : "vista, non dichiarata") : "dichiarata, mai vista"}
            className={cn(!v.vista && "border-dashed text-muted-foreground")}
          >
            {nomeVlan(v.vid)}
            <span className="text-xs opacity-70">{v.mac}</span>
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subnet ({retiFiltrate.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {retiFiltrate.length === 0 && <p className="text-muted-foreground text-sm">Nessuna subnet dedotta finora.</p>}
            {retiFiltrate.map((x) => {
              const chiave = `${x.vid}-${x.cidr}`;
              const max = Math.max(1, ...x.serie.map((g) => g.noti));
              return (
                <div
                  key={chiave}
                  role="button"
                  tabIndex={0}
                  onClick={() => setScelta(chiave)}
                  onKeyDown={(e) => { if (e.key === "Enter") setScelta(chiave); }}
                  className={cn(
                    "cursor-pointer rounded-md border p-3 text-sm transition-colors hover:bg-muted/50",
                    reteScelta && `${reteScelta.vid}-${reteScelta.cidr}` === chiave && "border-[#00A7E7] bg-[#00A7E7]/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">{x.cidr}</span>
                    <Badge variant="secondary">VLAN {nomeVlan(x.vid)}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {x.ip.length} IP
                    {x.gateway_ip && (x.fonte === "dhcp" ? ` · gw ${x.gateway_ip}` : ` · IP più cercato ${x.gateway_ip}`)}
                  </div>
                  <div className="mt-2 flex h-6 items-end gap-0.5" title="IP conosciuti giorno per giorno">
                    {x.serie.map((g) => (
                      <div
                        key={g.giorno}
                        className={cn("flex-1 rounded-sm", g.nuovi > 0 ? "bg-[#FFD400]" : "bg-[#00A7E7]/60")}
                        style={{ height: `${Math.max(8, (g.noti / max) * 100)}%` }}
                        title={`${g.giorno}: ${g.noti} noti, ${g.attivi} attivi, ${g.nuovi} nuovi`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" disabled={inCorso || !attiva} onClick={() => void giroArp(x.vid, x.cidr)}>
                      Giro ARP
                    </Button>
                    {retiIpam.includes(x.cidr) ? (
                      <Badge variant="secondary">in DA-IPAM</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void portaInIpam(x.vid, x.cidr, x.fonte === "dhcp" ? x.gateway_ip : null)}>
                        Porta in DA-IPAM
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Tabs defaultValue="griglia">
          <TabsList>
            <TabsTrigger value="griglia">Mappa /24</TabsTrigger>
            <TabsTrigger value="inventario">Inventario IP e MAC</TabsTrigger>
            <TabsTrigger value="tempo">Nel tempo</TabsTrigger>
          </TabsList>

          <TabsContent value="griglia" className="mt-4">
            {reteScelta ? (
              <Griglia
                key={`${reteScelta.vid}-${reteScelta.cidr}`}
                rete={reteScelta}
                inCorso={inCorso || !attiva}
                onGiro={() => void giroArp(reteScelta.vid, reteScelta.cidr)}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Scegli una subnet.</p>
            )}
          </TabsContent>

          <TabsContent value="inventario" className="mt-4">
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    IP e MAC {vid != null ? `della VLAN ${nomeVlan(vid)}` : ""} ({totale})
                  </CardTitle>
                  <Input
                    className="w-56"
                    placeholder="Cerca IP, MAC, nome"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void carica(vid, metodo, q, 0); }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {METODI.map((m) => (
                    <Button key={m.etichetta} size="sm" variant={metodo === m.id ? "default" : "outline"} onClick={() => void carica(vid, m.id, q, 0)}>
                      {m.etichetta}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {errore && <LoadError what="le osservazioni del trunk" message={errore} onRetry={() => void carica(vid, metodo, q, offset)} />}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Produttore</TableHead>
                      <TableHead>VLAN</TableHead>
                      <TableHead>Come</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Ultima vista</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {righe.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono">{o.ip || "—"}</TableCell>
                        <TableCell className="font-mono">{o.mac_display}</TableCell>
                        <TableCell className="text-xs">{o.vendor ?? "—"}</TableCell>
                        <TableCell className="font-mono">{nomeVlan(o.vid)}</TableCell>
                        <TableCell className="text-xs">{comeTrovato(o.passivo, o.attivo)}</TableCell>
                        <TableCell>{o.nome ?? "—"}</TableCell>
                        <TableCell className="text-xs">{o.ultima_vista}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => void carica(vid, metodo, q, Math.max(offset - PAGINA, 0))}>
                    Precedenti
                  </Button>
                  <span className="text-muted-foreground">
                    {totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, totale)}`} di {totale}
                  </span>
                  <Button size="sm" variant="outline" disabled={offset + PAGINA >= totale} onClick={() => void carica(vid, metodo, q, offset + PAGINA)}>
                    Successivi
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tempo" className="mt-4">
            <MatriceReti
              matrice={{ giorni: iniziale.matrice.giorni, reti: retiFiltrate }}
              retiIpam={retiIpam}
              inCorso={inCorso || !attiva}
              onGiro={(v, cidr) => void giroArp(v, cidr)}
              onPorta={(v, cidr, gw) => void portaInIpam(v, cidr, gw)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Kpi({ titolo, valore, nota }: { titolo: string; valore: number; nota: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-muted-foreground text-xs">{titolo}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[#0D2537] dark:text-white">{valore.toLocaleString("it-IT")}</p>
        <p className="text-muted-foreground mt-1 text-xs">{nota}</p>
      </CardContent>
    </Card>
  );
}

const COLORI = {
  gateway: "bg-[#FFD400] text-[#0D2537]",
  ascolto: "bg-[#00A7E7]/35 text-[#0D2537] dark:text-white",
  giro: "bg-[#0D2537] text-white dark:bg-slate-300 dark:text-[#0D2537]",
  entrambi: "bg-[#00A7E7] text-white",
  libero: "bg-muted text-muted-foreground/60",
} as const;

function tipoCella(i: TrunkIpVisto | undefined, gateway: boolean): keyof typeof COLORI {
  if (gateway) return "gateway";
  if (!i) return "libero";
  if (i.passivo && i.attivo) return "entrambi";
  return i.attivo ? "giro" : "ascolto";
}

function Griglia({ rete, inCorso, onGiro }: { rete: TrunkReteMatrice; inCorso: boolean; onGiro: () => void }) {
  const blocchi = blocchi24(rete);
  const [blocco, setBlocco] = useState(blocchi[0]);
  const [scelto, setScelto] = useState<string | null>(null);
  const perIp = new Map(rete.ip.map((i) => [i.ip, i]));
  const dettaglio = scelto ? perIp.get(scelto) : undefined;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Mappa {blocco}.0/24 <span className="text-muted-foreground font-normal">· VLAN {nomeVlan(rete.vid)}</span>
          </CardTitle>
          {blocchi.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {blocchi.map((b) => (
                <Button key={b} size="sm" variant={b === blocco ? "default" : "outline"} onClick={() => setBlocco(b)}>
                  {b}.x
                </Button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
            {Array.from({ length: 256 }, (_, n) => {
              const ip = `${blocco}.${n}`;
              const dentro = ipInCidr(ip, rete.cidr);
              const tipo = tipoCella(perIp.get(ip), ip === rete.gateway_ip);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!dentro}
                  onClick={() => setScelto(ip)}
                  title={ip}
                  className={cn(
                    "aspect-square rounded-sm font-mono text-[0.6rem] leading-none transition-transform hover:scale-110",
                    dentro ? COLORI[tipo] : "opacity-20 bg-muted",
                    scelto === ip && "ring-2 ring-[#0D2537] dark:ring-white",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
            <Legenda c={COLORI.gateway} t="gateway / IP più cercato" />
            <Legenda c={COLORI.ascolto} t="visto in ascolto" />
            <Legenda c={COLORI.giro} t="silenzioso, trovato col giro ARP" />
            <Legenda c={COLORI.entrambi} t="ascolto + giro ARP" />
            <Legenda c={COLORI.libero} t="mai visto" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{scelto ?? "Scegli un indirizzo"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!scelto && <p className="text-muted-foreground">Clicca una casella della mappa per vedere cosa si sa di quell&apos;indirizzo.</p>}
          {scelto && !dettaglio && (
            <p className="text-muted-foreground">
              Mai visto sul trunk. Se pensi che ci sia un apparato silenzioso (stampante, PLC, NAS), lancia un giro ARP sulla subnet.
            </p>
          )}
          {dettaglio && (
            <dl className="space-y-1.5">
              <Voce n="MAC" v={dettaglio.mac} mono />
              <Voce n="Produttore" v={dettaglio.vendor ?? "—"} />
              <Voce n="Nome" v={dettaglio.nome ?? "—"} />
              <Voce n="Come" v={comeTrovato(dettaglio.passivo, dettaglio.attivo)} />
              <Voce n="Prima vista" v={dettaglio.prima_vista} />
              <Voce n="Ultima vista" v={dettaglio.ultima_vista} />
            </dl>
          )}
          <Button size="sm" variant="outline" className="w-full" disabled={inCorso} onClick={onGiro}>
            Giro ARP su {rete.cidr}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Legenda({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", c)} />
      {t}
    </span>
  );
}

function Voce({ n, v, mono }: { n: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{n}</dt>
      <dd className={cn("text-right", mono && "font-mono")}>{v}</dd>
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
