"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cable, Fingerprint, Network, Search, Waypoints, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type {
  TrunkIpVisto, TrunkMetodo, TrunkOsservazioneRiga, TrunkReteMatrice, TrunkVlanProtocolli, TrunkVlanRiga,
} from "@/lib/trunk/sensore-trunk";

const PAGINA = 100;
/** Ciano leggibile come testo (il #00A7E7 resta per bordi e riempimenti). */
const CIANO_TESTO = "text-[#006C96] dark:text-[#5CCBF5]";

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
  vlanProtocolli: TrunkVlanProtocolli[];
  righe: TrunkOsservazioneRiga[];
  totale: number;
  retiIpam: string[];
  matrice: { giorni: string[]; reti: TrunkReteMatrice[] };
  riepilogo: Riepilogo;
}

const METODI: Array<{ id: TrunkMetodo | ""; etichetta: string }> = [
  { id: "", etichetta: "Tutti (ascolto e giro ARP)" },
  { id: "ascolto", etichetta: "Solo in ascolto" },
  { id: "giro", etichetta: "Silenziosi: trovati solo col giro ARP" },
  { id: "entrambi", etichetta: "In ascolto e confermati col giro ARP" },
];

const nomeVlan = (vid: number) => (vid === 0 ? "nativa" : String(vid));
const chiaveRete = (r: { vid: number; cidr: string }) => `${r.vid}-${r.cidr}`;

function fa(iso: string | null): string {
  if (!iso) return "mai";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "adesso";
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const n = (x: string) => x.split(".").reduce((a, p) => a * 256 + (Number(p) || 0), 0);
  const blocco = 2 ** (32 - bits);
  return Math.floor(n(ip) / blocco) === Math.floor(n(base) / blocco);
}

export function TrunkClient({ iniziale }: { iniziale: Dati }) {
  const router = useRouter();
  const { attiva, riepilogo: r, matrice } = iniziale;
  const [righe, setRighe] = useState(iniziale.righe);
  const [totale, setTotale] = useState(iniziale.totale);
  const [vid, setVid] = useState<number | null>(null);
  const [rete, setRete] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<TrunkMetodo | "">("");
  const [q, setQ] = useState("");
  const [cercaVlan, setCercaVlan] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [vista, setVista] = useState<"elenco" | "mappa">("elenco");
  const [retiIpam, setRetiIpam] = useState<string[]>(iniziale.retiIpam);

  const protoPerVlan = useMemo(() => new Map(iniziale.vlanProtocolli.map((p) => [p.vid, p])), [iniziale.vlanProtocolli]);
  const vlanVisibili = iniziale.vlan.filter((v) => !cercaVlan.trim() || nomeVlan(v.vid).includes(cercaVlan.trim())
    || v.reti.some((x) => x.cidr.includes(cercaVlan.trim()))
    || (protoPerVlan.get(v.vid)?.protocolli ?? []).some((p) => p.toLowerCase().includes(cercaVlan.trim().toLowerCase())));
  const retiVisibili = matrice.reti.filter((x) => vid == null || x.vid === vid);
  const reteScelta = matrice.reti.find((x) => chiaveRete(x) === rete) ?? null;

  /** La subnet (e il suo gateway) di una riga dell'elenco, dalle reti dedotte della sua VLAN. */
  const reteDi = (o: { vid: number; ip: string }) => matrice.reti.find((x) => x.vid === o.vid && o.ip && ipInCidr(o.ip, x.cidr));

  const carica = useCallback(async (filtro: { vid: number | null; rete: TrunkReteMatrice | null; metodo: TrunkMetodo | ""; q: string; off: number }) => {
    const p = new URLSearchParams({ limit: String(PAGINA), offset: String(filtro.off) });
    if (filtro.vid != null) p.set("vid", String(filtro.vid));
    if (filtro.rete) p.set("cidr", filtro.rete.cidr);
    if (filtro.metodo) p.set("metodo", filtro.metodo);
    if (filtro.q.trim()) p.set("q", filtro.q.trim());
    const res = await fetchJson<{ osservazioni: TrunkOsservazioneRiga[]; totale: number }>(`/api/trunk?${p.toString()}`);
    if (!res.ok) {
      setErrore(res.message);
      return;
    }
    setErrore(null);
    setRighe(res.data.osservazioni);
    setTotale(res.data.totale);
    setOffset(filtro.off);
  }, []);

  const filtra = (cambi: Partial<{ vid: number | null; rete: string | null; metodo: TrunkMetodo | ""; q: string; off: number }>) => {
    const nuovo = { vid, rete, metodo, q, off: 0, ...cambi };
    setVid(nuovo.vid);
    setRete(nuovo.rete);
    setMetodo(nuovo.metodo);
    void carica({ ...nuovo, rete: matrice.reti.find((x) => chiaveRete(x) === nuovo.rete) ?? null });
  };

  const portaInIpam = async (x: TrunkReteMatrice) => {
    const res = await fetchJson<{ id: number }>("/api/trunk/rete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vid: x.vid, cidr: x.cidr, gateway: x.fonte === "dhcp" ? x.gateway_ip : null }),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRetiIpam((l) => [...l, x.cidr]);
    toast.success(`Rete ${x.cidr} creata in DA-IPAM`);
    router.refresh();
  };

  const giroArp = async (x: { vid: number; cidr: string }) => {
    setInCorso(true);
    try {
      const res = await fetchJson<{ id: number }>("/api/trunk/giro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: x.vid, cidr: x.cidr }),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Giro ARP avviato su ${x.cidr}: i risultati compaiono alla prossima lettura`);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stato del sensore: una riga, l'azione una volta sola. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span className={cn("h-2.5 w-2.5 rounded-full", attiva ? "bg-[#00A7E7]" : "bg-muted-foreground/40")} />
            Sensore trunk {attiva ? "acceso" : "spento"}
          </span>
          <span className="text-muted-foreground">
            {attiva ? `solo ascolto · ultima lettura ${fa(r.aggiornato)} · le scansioni partono dall'IP ufficiale` : "nessuna lettura finché non lo accendi"}
          </span>
        </div>
        <Button size="sm" variant={attiva ? "outline" : "default"} render={<Link href="/settings/opzioni#modulo.sensore_trunk" />}>
          {attiva ? "Impostazioni" : "Accendi in Opzioni"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tessera icona={<Waypoints className="h-5 w-5" />} titolo="VLAN viste sul trunk" valore={r.vlan}
          dettaglio={`${iniziale.vlan.filter((v) => v.vista && !v.dichiarata).length} non dichiarate · ${iniziale.vlan.filter((v) => !v.vista).length} mai viste`}
          nota="dai tag 802.1Q, senza IP sulla scheda" />
        <Tessera icona={<Network className="h-5 w-5" />} titolo="Subnet dedotte" valore={matrice.reti.length}
          dettaglio={`${matrice.reti.filter((x) => retiIpam.includes(x.cidr)).length} già in DA-IPAM`}
          nota="da ARP, DHCP e broadcast" />
        <Tessera icona={<Cable className="h-5 w-5" />} titolo="Indirizzi IP" valore={r.ip}
          dettaglio={`${r.soloAscolto} in ascolto · ${r.soloGiro} silenziosi`}
          nota="senza leggere la tabella ARP del router" />
        <Tessera icona={<Fingerprint className="h-5 w-5" />} titolo="MAC unici" valore={r.mac}
          dettaglio={`${r.osservazioni} osservazioni`} nota="un MAC può stare su più VLAN" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* 1. VLAN */}
        <Pannello numero={1} titolo="VLAN viste sul trunk" conteggio={iniziale.vlan.length} sottotitolo="Scegli una VLAN per filtrare subnet ed elenco"
          className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
          azioni={<Button size="sm" variant={vid == null ? "default" : "outline"} onClick={() => filtra({ vid: null, rete: null })}>Tutte</Button>}>
          <div className="relative mb-3">
            <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
            <Input className="pl-8" placeholder="Cerca VLAN, subnet, protocollo" value={cercaVlan} onChange={(e) => setCercaVlan(e.target.value)} />
          </div>
          <div className="space-y-2">
            {vlanVisibili.length === 0 && <p className="text-muted-foreground text-sm">Nessuna VLAN letta finora.</p>}
            {vlanVisibili.map((v) => {
              const p = protoPerVlan.get(v.vid);
              return (
                <button key={v.vid} type="button" onClick={() => filtra({ vid: vid === v.vid ? null : v.vid, rete: null })}
                  className={cn("w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
                    vid === v.vid && "border-[#00A7E7] bg-[#00A7E7]/5 ring-1 ring-[#00A7E7]")}>
                  <div className="flex items-center justify-between gap-2">
                    <EtichettaVlan vid={v.vid} />
                    <span className="text-muted-foreground font-mono text-[13px]">{v.mac} MAC</span>
                  </div>
                  <div className="mt-1.5 text-[13px]">
                    {!v.vista ? (
                      <span className="text-destructive">dichiarata, mai vista</span>
                    ) : (
                      <>
                        {v.reti.length} subnet · <span className={cn("font-medium", CIANO_TESTO)}>{p?.ip ?? 0} IP</span>
                        {!v.dichiarata && <span className="text-muted-foreground"> · non dichiarata</span>}
                      </>
                    )}
                  </div>
                  {p && p.protocolli.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">{p.protocolli.map((x) => <Tag key={x}>{x}</Tag>)}</div>
                  )}
                </button>
              );
            })}
          </div>
        </Pannello>

        <div className="space-y-4">
          {/* 2. Subnet */}
          <Pannello numero={2} titolo="Subnet rilevate" conteggio={retiVisibili.length}
            sottotitolo="Scegli una subnet per vederne gli indirizzi. Il giro ARP trova gli apparati silenziosi (stampanti, PLC, NAS) e parte solo se lo chiedi."
            filtro={vid != null ? `VLAN ${nomeVlan(vid)}` : undefined}>
            {retiVisibili.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nessuna subnet dedotta finora.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {retiVisibili.map((x) => <SchedaRete key={chiaveRete(x)} rete={x} scelta={rete === chiaveRete(x)} inIpam={retiIpam.includes(x.cidr)}
                  giroDisabilitato={inCorso || !attiva}
                  onScegli={() => filtra({ rete: rete === chiaveRete(x) ? null : chiaveRete(x), vid: rete === chiaveRete(x) ? vid : x.vid })}
                  onGiro={() => void giroArp(x)} onPorta={() => void portaInIpam(x)} />)}
              </div>
            )}
          </Pannello>

        </div>
      </div>

      {/* 3. Inventario: l'elenco è la vista principale, la mappa /24 una seconda lettura. */}
      <Pannello numero={3} titolo="Inventario IP e MAC" conteggio={totale}
        sottotitolo="Ogni indirizzo visto sul trunk, con il produttore della scheda e come è stato trovato"
        filtro={reteScelta ? reteScelta.cidr : vid != null ? `VLAN ${nomeVlan(vid)}` : undefined}
        azioni={
          <div className="flex rounded-md border p-0.5">
            {(["elenco", "mappa"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setVista(k)}
                className={cn("rounded px-3 py-1 text-sm", vista === k ? "bg-[#0D2537] text-white dark:bg-white dark:text-[#0D2537]" : "text-muted-foreground")}>
                {k === "elenco" ? "Elenco" : "Mappa /24"}
              </button>
            ))}
          </div>
        }>
        {vista === "mappa" ? (
          reteScelta ? <Griglia key={chiaveRete(reteScelta)} rete={reteScelta} />
            : <p className="text-muted-foreground text-sm">Scegli una subnet qui sopra per vederne la mappa.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select value={metodo} onChange={(e) => filtra({ metodo: e.target.value as TrunkMetodo | "" })}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm">
                {METODI.map((m) => <option key={m.id} value={m.id}>{m.etichetta}</option>)}
              </select>
              <div className="relative min-w-56 flex-1">
                <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
                <Input className="pl-8" placeholder="Filtra IP, MAC, nome" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") filtra({ q }); }} />
              </div>
            </div>
            {errore && <LoadError what="l'inventario del trunk" message={errore} onRetry={() => filtra({ off: offset })} />}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Indirizzo IP</TableHead>
                    <TableHead>MAC</TableHead>
                    <TableHead>Produttore</TableHead>
                    <TableHead>VLAN e subnet</TableHead>
                    <TableHead>Come è stato trovato</TableHead>
                    <TableHead>Nome e protocolli</TableHead>
                    <TableHead>Ultimo visto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {righe.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground py-6 text-center">Nessun indirizzo con questi filtri.</TableCell></TableRow>
                  )}
                  {righe.map((o) => {
                    const sub = reteDi(o);
                    const gw = sub && sub.gateway_ip === o.ip;
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap font-mono font-medium">
                          {o.ip || "—"}
                          {gw && <Tag className="ml-2 border-[#FFD400] bg-[#FFD400]/25" >{sub.fonte === "dhcp" ? "GW" : "GW?"}</Tag>}
                        </TableCell>
                        <TableCell><span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[13px]">{o.mac_display}</span></TableCell>
                        <TableCell className="max-w-44 truncate text-[13px]" title={o.vendor ?? undefined}>{o.vendor ?? <span className="text-muted-foreground">sconosciuto</span>}</TableCell>
                        <TableCell className="whitespace-nowrap text-[13px]">
                          <span className={cn("font-mono", CIANO_TESTO)}>VLAN {nomeVlan(o.vid)}</span>
                          {sub && <span className="font-mono"> · {sub.cidr}</span>}
                        </TableCell>
                        <TableCell><Metodo passivo={o.passivo} attivo={o.attivo} /></TableCell>
                        <TableCell>
                          <div className="text-[13px]">{o.nome ?? <span className="text-muted-foreground">—</span>}</div>
                          {o.protocolli.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{o.protocolli.map((x) => <Tag key={x}>{x}</Tag>)}</div>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[13px]" title={o.ultima_vista}>{fa(o.ultima_vista)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => filtra({ off: Math.max(offset - PAGINA, 0) })}>Precedenti</Button>
              <span className="text-muted-foreground">{totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, totale)}`} di {totale}</span>
              <Button size="sm" variant="outline" disabled={offset + PAGINA >= totale} onClick={() => filtra({ off: offset + PAGINA })}>Successivi</Button>
            </div>
          </div>
        )}
      </Pannello>
    </div>
  );
}

function Tessera({ icona, titolo, valore, dettaglio, nota }: { icona: React.ReactNode; titolo: string; valore: number; dettaglio: string; nota: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-[13px] font-medium uppercase tracking-wide">{titolo}</p>
        <span className="rounded-md bg-[#00A7E7]/10 p-2 text-[#006C96] dark:text-[#5CCBF5]">{icona}</span>
      </div>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-[#0D2537] dark:text-white">{valore.toLocaleString("it-IT")}</span>
        <span className={cn("font-mono text-[13px]", CIANO_TESTO)}>{dettaglio}</span>
      </p>
      <p className="text-muted-foreground mt-1 text-[13px]">{nota}</p>
    </div>
  );
}

function Pannello({ numero, titolo, conteggio, sottotitolo, filtro, azioni, className, children }: {
  numero: number; titolo: string; conteggio: number; sottotitolo: string; filtro?: string; azioni?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#0D2537] dark:text-white">
            {numero}. {titolo}
            <span className="rounded bg-muted px-1.5 font-mono text-[13px] font-normal">{conteggio}</span>
            {filtro && <span className="rounded border border-[#00A7E7] px-1.5 font-mono text-[13px] font-normal normal-case text-[#006C96] dark:text-[#5CCBF5]">{filtro}</span>}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[13px]">{sottotitolo}</p>
        </div>
        {azioni}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EtichettaVlan({ vid }: { vid: number }) {
  return (
    <span className="rounded border border-[#00A7E7] bg-[#00A7E7]/10 px-2 py-0.5 font-mono text-sm font-semibold text-[#006C96] dark:text-[#5CCBF5]">
      {vid === 0 ? "Nativa" : `VLAN ${vid}`}
    </span>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-block rounded border px-1.5 font-mono text-[13px] leading-5 uppercase", className)}>{children}</span>;
}

function Metodo({ passivo, attivo }: { passivo: number; attivo: number }) {
  const c = "whitespace-nowrap font-sans normal-case";
  if (passivo && attivo) return <Tag className={cn(c, "border-[#00A7E7] bg-[#00A7E7] text-white")}>ascolto + giro ARP</Tag>;
  if (attivo) return <Tag className={cn(c, "border-[#0D2537] bg-[#0D2537] text-white dark:bg-slate-200 dark:text-[#0D2537]")}>silenzioso</Tag>;
  return <Tag className={cn(c, "border-[#00A7E7] bg-[#00A7E7]/10 text-[#006C96] dark:text-[#5CCBF5]")}>in ascolto</Tag>;
}

function SchedaRete({ rete, scelta, inIpam, giroDisabilitato, onScegli, onGiro, onPorta }: {
  rete: TrunkReteMatrice; scelta: boolean; inIpam: boolean; giroDisabilitato: boolean; onScegli: () => void; onGiro: () => void; onPorta: () => void;
}) {
  const ascolto = rete.ip.filter((i) => i.passivo).length;
  const soloGiro = rete.ip.filter((i) => !i.passivo && i.attivo).length;
  const gw = rete.gateway_ip ? rete.ip.find((i) => i.ip === rete.gateway_ip) : undefined;
  const oggi = rete.serie[rete.serie.length - 1];
  return (
    <div role="button" tabIndex={0} onClick={onScegli} onKeyDown={(e) => { if (e.key === "Enter") onScegli(); }}
      className={cn("flex cursor-pointer flex-col rounded-md border p-3 transition-colors hover:bg-muted/40",
        scelta && "border-[#00A7E7] bg-[#00A7E7]/5 ring-1 ring-[#00A7E7]")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-base font-semibold text-[#0D2537] dark:text-white">{rete.cidr}</span>
        <span className={cn("font-mono text-[13px]", CIANO_TESTO)}>{rete.ip.length} host</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <EtichettaVlan vid={rete.vid} />
        {oggi && oggi.nuovi > 0 && <Tag className="border-[#FFD400] bg-[#FFD400]/25 normal-case">+{oggi.nuovi} oggi</Tag>}
        {inIpam && <Tag className="normal-case">in DA-IPAM</Tag>}
      </div>
      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{rete.fonte === "dhcp" ? "Gateway (DHCP)" : "IP più cercato"}</dt>
          <dd className="text-right font-mono">
            {rete.gateway_ip ?? "—"}
            {gw?.vendor && <span className="text-muted-foreground block font-sans">{gw.vendor}</span>}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex justify-between text-[13px]">
        <span>In ascolto <b className={CIANO_TESTO}>{ascolto}</b></span>
        <span>Silenziosi <b>{soloGiro}</b></span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-[#00A7E7]" style={{ width: `${rete.ip.length ? (ascolto / rete.ip.length) * 100 : 0}%` }} />
        <div className="bg-[#0D2537] dark:bg-slate-300" style={{ width: `${rete.ip.length ? (soloGiro / rete.ip.length) * 100 : 0}%` }} />
      </div>
      <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" className="flex-1 border-[#FFD400] hover:bg-[#FFD400]/20" disabled={giroDisabilitato} onClick={onGiro}>
          <Zap className="h-4 w-4" /> Giro ARP
        </Button>
        {!inIpam && <Button size="sm" variant="outline" className="flex-1" onClick={onPorta}>Porta in DA-IPAM</Button>}
      </div>
    </div>
  );
}


/** Gli indirizzi di un /24 (i primi tre ottetti) dentro una subnet, con quelli visti. */
function blocchi24(rete: TrunkReteMatrice): string[] {
  const visti = new Set(rete.ip.map((i) => i.ip.split(".").slice(0, 3).join(".")));
  if (visti.size === 0) visti.add(rete.cidr.split("/")[0].split(".").slice(0, 3).join("."));
  return [...visti].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function comeTrovato(passivo: number, attivo: number): string {
  return [passivo ? "ascolto" : null, attivo ? "giro ARP" : null].filter(Boolean).join(" + ") || "—";
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

function Griglia({ rete }: { rete: TrunkReteMatrice }) {
  const blocchi = blocchi24(rete);
  const [blocco, setBlocco] = useState(blocchi[0]);
  const [scelto, setScelto] = useState<string | null>(null);
  const perIp = new Map(rete.ip.map((i) => [i.ip, i]));
  const dettaglio = scelto ? perIp.get(scelto) : undefined;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="rounded-md border">
        <div className="px-3 pt-3 flex flex-row flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Mappa {blocco}.0/24 <span className="text-muted-foreground font-normal">· VLAN {nomeVlan(rete.vid)}</span>
          </h3>
          {blocchi.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {blocchi.map((b) => (
                <Button key={b} size="sm" variant={b === blocco ? "default" : "outline"} onClick={() => setBlocco(b)}>
                  {b}.x
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="p-3 space-y-3">
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
                    "aspect-square rounded-sm font-mono text-[13px] leading-none transition-transform hover:scale-110",
                    dentro ? COLORI[tipo] : "opacity-20 bg-muted",
                    scelto === ip && "ring-2 ring-[#0D2537] dark:ring-white",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-3 text-[13px]">
            <Legenda c={COLORI.gateway} t="gateway / IP più cercato" />
            <Legenda c={COLORI.ascolto} t="visto in ascolto" />
            <Legenda c={COLORI.giro} t="silenzioso, trovato col giro ARP" />
            <Legenda c={COLORI.entrambi} t="ascolto + giro ARP" />
            <Legenda c={COLORI.libero} t="mai visto" />
          </div>
        </div>
      </div>
      <div className="rounded-md border">
        <div className="px-3 pt-3">
          <h3 className="text-sm font-semibold">{scelto ?? "Scegli un indirizzo"}</h3>
        </div>
        <div className="p-3 space-y-2 text-sm">
          {!scelto && <p className="text-muted-foreground">Clicca una casella della mappa per vedere cosa si sa di quell&apos;indirizzo.</p>}
          {scelto && !dettaglio && (
            <p className="text-muted-foreground">
              Mai visto sul trunk. Un apparato silenzioso (stampante, PLC, NAS) compare dopo un giro ARP sulla subnet.
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
        </div>
      </div>
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
