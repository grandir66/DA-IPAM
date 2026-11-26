"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { BarraStato, Etichetta, Pannello, TempoRelativo, TesseraNumero, VoceSelezionabile, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { ETICHETTA_APPARTENENZA } from "@/lib/trunk/appartenenza";
import type { IndirizzoRiga, PuntoAscolto, QuadroAscolto, ReteAscolto } from "@/lib/traffico/reti-collector";
import { PortaRete, type DaPortare } from "./porta-rete";
import { Dettaglio, fa, nuoviOggi } from "./pezzi-rete";

const PAGINA = 100;
/** Un collector si legge ogni 5 minuti: oltre i 15 non lo si sta sentendo. */
const MUTO_MS = 15 * 60_000;
const nomeVid = (vid: number) => (vid === 0 ? "Senza tag" : `VLAN ${vid}`);
const chiave = (r: { vid: number; cidr: string }) => `${r.vid}|${r.cidr}`;

interface Risposta { righe: IndirizzoRiga[]; totale: number; quadro: QuadroAscolto | null }

/** VLAN, reti e indirizzi visti dai collector di una sede, nella forma della pagina della sonda trunk. */
export function RetiCollector({ punto, admin }: { punto: PuntoAscolto; admin: boolean }) {
  const [quadro, setQuadro] = useState<QuadroAscolto | null>(null);
  const [elenco, setElenco] = useState<{ righe: IndirizzoRiga[]; totale: number } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [vid, setVid] = useState<number | null>(null);
  const [rete, setRete] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [scritto, setScritto] = useState("");
  const [offset, setOffset] = useState(0);
  const [daPortare, setDaPortare] = useState<DaPortare | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [adesso] = useState(() => Date.now());

  const cidr = rete?.split("|")[1] ?? null;
  const vidFiltro = rete ? Number(rete.split("|")[0]) : vid;
  const carica = useCallback(async (conQuadro: boolean) => {
    const p = new URLSearchParams({ sede: punto.sede, limit: String(PAGINA), offset: String(offset) });
    if (vidFiltro !== null) p.set("vid", String(vidFiltro));
    if (cidr) p.set("cidr", cidr);
    if (cerca) p.set("q", cerca);
    if (conQuadro) p.set("quadro", "1");
    const r = await fetchJson<Risposta>(`/api/traffico/reti-ascolto?${p.toString()}`, { cache: "no-store" });
    if (!r.ok) { setErrore(r.message); return; }
    setErrore(null);
    setElenco(r.data);
    if (r.data.quadro) setQuadro(r.data.quadro);
  }, [punto.sede, offset, vidFiltro, cidr, cerca]);
  const primo = quadro === null;
  useEffect(() => { void carica(primo); }, [carica, primo]);

  const scegliVlan = (v: number | null) => { setVid(v); setRete(null); setOffset(0); };
  const scegliRete = (r: ReteAscolto) => { setRete(rete === chiave(r) ? null : chiave(r)); setOffset(0); };
  const cercaOra = (e: FormEvent) => { e.preventDefault(); setCerca(scritto.trim()); setOffset(0); };

  const aggiungiHost = async (r: ReteAscolto) => {
    setOccupato(true);
    const e = await fetchJson<{ host: number }>("/api/traffico/reti-ascolto", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sede: punto.sede, vid: r.vid, cidr: r.cidr }),
    });
    setOccupato(false);
    if (!e.ok) { toast.error(e.message); return; }
    toast.success(`${e.data.host} host aggiunti a ${r.cidr}`);
    await carica(true);
  };

  const contatto = punto.ultimo_contatto ? Date.parse(`${punto.ultimo_contatto.replace(" ", "T")}Z`) : 0;
  const vivo = punto.attivi > 0 && adesso - contatto < MUTO_MS;
  const n = quadro?.numeri;
  const retiVisibili = (quadro?.reti ?? []).filter((r) => vid === null || r.vid === vid);
  const scelta = quadro?.reti.find((r) => chiave(r) === rete) ?? null;
  const altreVlan = (r: ReteAscolto) => (quadro?.reti ?? []).filter((x) => x.cidr === r.cidr && x.vid !== r.vid).map((x) => nomeVid(x.vid));

  return (
    <div className="space-y-4">
      <BarraStato
        acceso={vivo}
        titolo={punto.collector.length === 1 ? "Collector" : `${punto.collector.length} collector`}
        dettagli={[punto.collector.join(", "), punto.ultimo_contatto ? `letti ${fa(punto.ultimo_contatto.replace(" ", "T"))}` : "mai letti", "solo ascolto: ARP e DHCP degli ultimi 14 giorni"]}
      />
      {errore !== null ? (
        <LoadError what={`le reti viste a ${punto.sede}`} message={errore} onRetry={() => void carica(true)} />
      ) : quadro === null || elenco === null ? (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground" role="status">Carico le reti viste…</p>
      ) : quadro.reti.length === 0 ? (
        <Vuoto titolo="Nessuna rete vista finora" testo="Le reti compaiono quando i collector di questa sede sentono una richiesta ARP o DHCP." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TesseraNumero titolo="VLAN viste" valore={n?.vlan ?? null} nota="contando anche «senza tag»" />
            <TesseraNumero titolo="Reti" valore={n?.reti ?? null} qualifica={`${n?.reti_censite ?? 0} in DA-IPAM`} nota="dagli indirizzi visti" />
            <TesseraNumero titolo="Indirizzi IP" valore={n?.ip ?? null} nota="visti senza leggere il router" />
            <TesseraNumero titolo="Nuovi in 7 giorni" valore={n?.nuovi7 ?? null} nota="indirizzi mai visti prima" />
          </div>

          <Pannello numero={1} titolo={`VLAN viste a ${punto.sede}`} conteggio={quadro.vlan.length} sottotitolo="Scegli una VLAN: sotto le sue reti"
            azioni={<Button size="sm" variant={vid === null ? "default" : "outline"} onClick={() => scegliVlan(null)}>Tutte</Button>}>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}>
              {quadro.vlan.map((v) => (
                <VoceSelezionabile key={v.vid} scelta={vid === v.vid} className="flex flex-col gap-1.5 p-2.5" onScegli={() => scegliVlan(vid === v.vid ? null : v.vid)}>
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="font-mono font-semibold">{nomeVid(v.vid)}</span>
                    <span className="font-mono text-[13px] text-muted-foreground">{v.ip} IP</span>
                  </div>
                  <div className="truncate text-[13px] text-muted-foreground">{v.reti.length === 1 ? v.reti[0] : `${v.reti.length} reti`}</div>
                  <div className="text-[13px]">{v.censita ? "✓ in DA-IPAM" : "● non in DA-IPAM"}</div>
                </VoceSelezionabile>
              ))}
            </div>
          </Pannello>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Pannello numero={2} titolo="Reti" conteggio={retiVisibili.length} sottotitolo="Una voce per rete e VLAN"
              azioni={vid !== null ? <Etichetta tono="marca">{nomeVid(vid)}</Etichetta> : undefined}>
              <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
                {retiVisibili.map((r) => (
                  <VoceSelezionabile key={chiave(r)} scelta={rete === chiave(r)} className="flex flex-col gap-1.5 p-2.5" onScegli={() => scegliRete(r)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[15px] font-semibold">{r.cidr}</span>
                      <span className="text-[13px]">{r.censita ? "✓ in DA-IPAM" : "● non in DA-IPAM"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                      <span>{vid === null && `${nomeVid(r.vid)} · `}{r.ip.length} IP{r.nome_rete && ` · ${r.nome_rete}`}</span>
                      {nuoviOggi(r) > 0 && <Etichetta tono="ruolo">+{nuoviOggi(r)} oggi</Etichetta>}
                    </div>
                    {r.mancanti > 0 && <div className="text-[13px]">▲ {r.mancanti === 1 ? "1 indirizzo visto non è un host" : `${r.mancanti} indirizzi visti non sono host`}</div>}
                    {altreVlan(r).length > 0 && <div><Etichetta tono="ruolo" mono={false}>▲ stessa rete anche su {altreVlan(r).join(", ")}</Etichetta></div>}
                  </VoceSelezionabile>
                ))}
              </div>
            </Pannello>
            {scelta ? (
              <Dettaglio key={chiave(scelta)} rete={scelta} giorni={quadro.giorni} inIpam={scelta.censita} etichetta={nomeVid(scelta.vid)} portaDisabilitata={occupato}
                perche={scelta.censita ? `quella della rete «${scelta.nome_rete}» di DA-IPAM` : "dedotta dagli indirizzi visti: si può cambiare portandola in DA-IPAM"}
                onPorta={admin ? () => setDaPortare({ sede: punto.sede, vid: scelta.vid, cidr: scelta.cidr, ip: scelta.ip.length }) : undefined}
                azioni={admin && scelta.censita && scelta.mancanti > 0 ? (
                  <Button size="sm" disabled={occupato} onClick={() => void aggiungiHost(scelta)}>
                    {occupato ? "Aggiungo…" : scelta.mancanti === 1 ? "Aggiungi l'host che manca" : `Aggiungi i ${scelta.mancanti} host che mancano`}
                  </Button>
                ) : undefined} />
            ) : (
              <Pannello numero={3} titolo="Dettaglio della rete" conteggio="—">
                <p className="py-8 text-center text-[13px] text-muted-foreground">Scegli una rete a sinistra per vedere crescita e occupazione.</p>
              </Pannello>
            )}
          </div>

          <Pannello numero={4} titolo="Indirizzi IP e MAC" conteggio={elenco.totale} sottotitolo="Ogni indirizzo visto dai collector, col produttore della scheda e chi l'ha visto" corpoClassName="p-0"
            azioni={
              <>
                {(scelta || vid !== null) && <Etichetta tono="marca">{scelta ? scelta.cidr : nomeVid(vid as number)}</Etichetta>}
                <form onSubmit={cercaOra} className="relative w-64 max-w-full">
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                  <Input className="h-8 pl-8" placeholder="Cerca IP, MAC, nome" aria-label="Cerca IP, MAC, nome" value={scritto} onChange={(e) => setScritto(e.target.value)} />
                </form>
                {cerca && <Button size="sm" variant="outline" onClick={() => { setCerca(""); setScritto(""); setOffset(0); }}>Togli</Button>}
              </>
            }
            piede={
              <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGINA, 0))}>Precedenti</Button>
                <span className="text-muted-foreground">{elenco.totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, elenco.totale)}`} di {elenco.totale}</span>
                <Button size="sm" variant="outline" disabled={offset + PAGINA >= elenco.totale} onClick={() => setOffset(offset + PAGINA)}>Successivi</Button>
              </div>
            }>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indirizzo IP</TableHead><TableHead>MAC</TableHead><TableHead>Produttore</TableHead><TableHead>VLAN · rete</TableHead>
                  <TableHead>Appartenenza</TableHead><TableHead>Nome e protocolli</TableHead><TableHead>Visto da</TableHead><TableHead>Ultimo visto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {elenco.righe.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nessun indirizzo con questi filtri.</TableCell></TableRow>}
                {elenco.righe.map((o) => {
                  const a = ETICHETTA_APPARTENENZA[o.appartenenza.tag];
                  return (
                    <TableRow key={`${o.vid}|${o.ip}|${o.mac}`}>
                      <TableCell className="whitespace-nowrap font-mono font-semibold">{o.ip}</TableCell>
                      <TableCell className="font-mono text-[13px]">{o.mac}</TableCell>
                      <TableCell className="max-w-44 truncate" title={o.vendor ?? undefined}>{o.vendor ?? <span className="text-muted-foreground">sconosciuto</span>}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[13px]"><span className="text-cian-testo">{nomeVid(o.vid)}</span> · {o.cidr}</TableCell>
                      <TableCell className="whitespace-nowrap text-[13px]" title={a.spiega}>{a.segno} {a.testo}{o.appartenenza.rete && ` · ${o.appartenenza.rete}`}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          {o.nome ? <span className="mr-1 font-mono text-[13px]">{o.nome}</span> : <span className="mr-1 text-muted-foreground">—</span>}
                          {o.protocolli.map((p) => <Etichetta key={p}>{p.toUpperCase()}</Etichetta>)}
                        </span>
                      </TableCell>
                      <TableCell className="text-[13px]" title={o.collector.join(", ")}>{o.collector.length > 2 ? `${o.collector.length} collector` : o.collector.join(", ")}</TableCell>
                      <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground"><TempoRelativo data={o.ultima_vista} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Pannello>
        </>
      )}
      {daPortare && <PortaRete rete={daPortare} onChiudi={() => setDaPortare(null)} onFatto={() => { setDaPortare(null); void carica(true); }} />}
    </div>
  );
}
