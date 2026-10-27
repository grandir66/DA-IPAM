"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import {
  BarraStato, Etichetta, Legenda, Pannello, SchedePagina, TesseraNumero, VoceSelezionabile, Vuoto,
} from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type {
  TrunkEsitoLettura, TrunkMetodo, TrunkOsservazioneRiga, TrunkStatoSonda, TrunkReteMatrice, TrunkVlanProtocolli, TrunkVlanRiga,
} from "@/lib/trunk/sensore-trunk";
import type { TrunkMaschera } from "@/lib/trunk/reti";
import { TIPI_RILIEVO, type TipoRilievo } from "@/lib/trunk/rilievi-tipi";
import { PannelloRilievi, type DatiRilievi } from "./rilievi-pannello";

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
  vlanProtocolli: TrunkVlanProtocolli[];
  righe: TrunkOsservazioneRiga[];
  totale: number;
  retiIpam: string[];
  matrice: { giorni: string[]; reti: TrunkReteMatrice[] };
  riepilogo: Riepilogo;
  sonda: TrunkStatoSonda;
  ultimoEsito: TrunkEsitoLettura | null;
  rilievi: DatiRilievi;
}

/** Segno breve dei rilievi aperti su un indirizzo, nell'elenco: il dettaglio sta nel pannello in alto. */
const SEGNO_RILIEVO: Partial<Record<TipoRilievo, string>> = {
  dhcp_non_previsto: "✕ DHCP non previsto",
  fuori_rete: "▲ fuori rete",
  nomi_insicuri: "▲ LLMNR/NetBIOS",
  piu_vlan: "● più VLAN",
  non_in_inventario: "● non in inventario",
};

/** Il filtro «come è stato trovato»: quattro pulsanti, ognuno col suo segno (non solo il colore). */
const METODI: Array<{ id: TrunkMetodo | ""; etichetta: string }> = [
  { id: "", etichetta: "Tutti" },
  { id: "ascolto", etichetta: "● In ascolto" },
  { id: "giro", etichetta: "▲ Silenziosi" },
  { id: "entrambi", etichetta: "◆ Confermati" },
];

const MASCHERA: Record<TrunkMaschera, { testo: string; classe: string; spiega: string }> = {
  dhcp: { testo: "✓ DHCP", classe: "bg-[#1F7A4D] text-white border-[#1F7A4D]", spiega: "Maschera annunciata dal DHCP" },
  dedotta: { testo: "≈ dedotta", classe: "bg-[#FFD400] text-[#0D2537] border-[#C9A800]", spiega: "/24 vicini con lo stesso gateway uniti" },
  incerta: { testo: "? incerta", classe: "border-dashed border-[#C9A800] text-foreground", spiega: "IP sparsi: la rete copre quelli visti, da confermare" },
  config: { testo: "✎ impostata", classe: "bg-[#0D2537] text-white border-[#0D2537] dark:bg-[#E7EAEB] dark:text-[#0D2537]", spiega: "Scritta a mano" },
};

const PREFISSI = [16, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

const nomeVlan = (vid: number) => (vid === 0 ? "Nativa" : `VLAN ${vid}`);
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

function ipNumero(ip: string): number {
  return ip.split(".").reduce((a, p) => a * 256 + (Number(p) || 0), 0);
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const blocco = 2 ** (32 - Number(bits));
  return Math.floor(ipNumero(ip) / blocco) === Math.floor(ipNumero(base) / blocco);
}

const silenziosi = (x: TrunkReteMatrice) => x.ip.filter((i) => !i.passivo && i.attivo).length;
const nuoviIn = (x: TrunkReteMatrice, giorni: number) => x.serie.slice(-giorni).reduce((a, g) => a + g.nuovi, 0);
const nuoviOggi = (x: TrunkReteMatrice) => x.serie[x.serie.length - 1]?.nuovi ?? 0;

type Scheda = "sicurezza" | "reti";

export function TrunkClient({ iniziale, admin }: { iniziale: Dati; admin: boolean }) {
  const router = useRouter();
  const { attiva, riepilogo: r, matrice, sonda, ultimoEsito } = iniziale;
  const [righe, setRighe] = useState(iniziale.righe);
  const [totale, setTotale] = useState(iniziale.totale);
  const [vid, setVid] = useState<number | null>(null);
  const [rete, setRete] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<TrunkMetodo | "">("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [retiIpam, setRetiIpam] = useState<string[]>(iniziale.retiIpam);
  // Due schede (Riccardo, 25/10: in una pagina sola diventava troppo lunga). La scheda sta nell'indirizzo
  // (#sicurezza, #reti), così il badge del menu e un collegamento aprono quella giusta.
  const [scheda, setScheda] = useState<Scheda>("sicurezza");
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "reti" || h === "sicurezza") setScheda(h);
  }, []);
  const scegliScheda = useCallback((v: Scheda) => {
    setScheda(v);
    window.history.replaceState(null, "", `#${v}`);
  }, []);

  const retiPerVid = useMemo(() => {
    const m = new Map<number, TrunkReteMatrice[]>();
    for (const x of matrice.reti) m.set(x.vid, [...(m.get(x.vid) ?? []), x]);
    return m;
  }, [matrice.reti]);
  /** Stessa rete su più VLAN: di solito un errore di configurazione, va segnalato. */
  const vidPerCidr = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const x of matrice.reti) m.set(x.cidr, [...(m.get(x.cidr) ?? []), x.vid]);
    return m;
  }, [matrice.reti]);
  const retiVisibili = vid == null ? matrice.reti : retiPerVid.get(vid) ?? [];
  const reteScelta = matrice.reti.find((x) => chiaveRete(x) === rete) ?? null;
  const reteDi = (o: { vid: number; ip: string }) => (retiPerVid.get(o.vid) ?? []).find((x) => o.ip && ipInCidr(o.ip, x.cidr));

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

  const correggiMaschera = async (x: TrunkReteMatrice, prefisso: number | null) => {
    const res = await fetchJson<{ ok: boolean }>("/api/trunk/maschera", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vid: x.vid, dedotta: x.dedotta, prefisso }),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRete(null);
    toast.success(prefisso == null ? "Maschera di nuovo dedotta dal sensore" : `Maschera impostata a /${prefisso}`);
    router.refresh();
  };

  const nonDichiarate = iniziale.vlan.filter((v) => v.vista && !v.dichiarata).length;
  const maiViste = iniziale.vlan.filter((v) => !v.vista).length;
  const blocchiVisti = matrice.reti.reduce((a, x) => a + x.blocchi.length, 0);
  const ril = iniziale.rilievi.riepilogo;
  const esposizioniLlmnr = ril.perTipo.find((t) => t.tipo === "nomi_insicuri")?.n ?? 0;
  const totSilenziosi = matrice.reti.reduce((a, x) => a + silenziosi(x), 0);

  return (
    <div className="space-y-4">
      <BarraStato
        acceso={sonda.raggiungibile && sonda.inAscolto}
        titolo="Sonda trunk"
        dettagli={sonda.raggiungibile ? [
          sonda.nic ? `scheda ${sonda.nic}` : "scheda non indicata",
          sonda.pacchettiAlSecondo != null ? `${Math.round(sonda.pacchettiAlSecondo)} pacchetti/s` : "traffico non misurato",
          sonda.tagLetti ? "tag VLAN letti" : "nessun tag VLAN visto",
          `letta dal ${sonda.fonte === "socket" ? "socket locale" : "Scanner-Edge"}`,
        ] : ["non risponde"]}
        azioni={
          <Button size="sm" variant={attiva ? "outline" : "default"} render={<Link href="/settings/opzioni#modulo.sensore_trunk" />}>
            {attiva ? "Impostazioni" : "Accendi in Opzioni"}
          </Button>
        }
      />
      <StatoLettura attiva={attiva} sonda={sonda} esito={ultimoEsito} aggiornato={r.aggiornato} />

      <SchedePagina
        etichetta="Parti della pagina"
        scelta={scheda}
        onScegli={scegliScheda}
        voci={[
          {
            valore: "sicurezza",
            titolo: "Sicurezza della rete",
            descrizione: `${ril.allarmi} allarmi · ${ril.esposizioni} esposizioni · ${ril.novita} novità`,
            segnale: ril.allarmiAlti > 0 ? (
              <span className="rounded-full bg-[#8E1B20] px-2 font-mono text-[13px] font-bold text-white" title="Allarmi gravi da prendere in carico">
                ✕ {ril.allarmiAlti}
              </span>
            ) : undefined,
          },
          {
            valore: "reti",
            titolo: "VLAN e reti",
            descrizione: `${iniziale.vlan.filter((v) => v.vista).length} VLAN viste · ${r.ip} indirizzi IP`,
          },
        ]}
      />

      {scheda === "sicurezza" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TesseraNumero titolo="Allarmi" valore={ril.allarmi}
              qualifica={ril.allarmiAlti ? `✕ ${ril.allarmiAlti} gravi da prendere` : "nessuno grave aperto"} nota="DHCP, IP contesi, indirizzi fuori rete" />
            <TesseraNumero titolo="Esposizioni" valore={ril.esposizioni}
              qualifica={`${esposizioniLlmnr} con LLMNR/NetBIOS`} nota="come è fatta la rete, con cosa fare" />
          </div>
          <PannelloRilievi iniziale={iniziale.rilievi} admin={admin} />
        </div>
      )}

      {scheda === "reti" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TesseraNumero titolo="VLAN viste" valore={iniziale.vlan.filter((v) => v.vista).length}
              qualifica={`${nonDichiarate} non dichiarate`} nota={`${maiViste} dichiarate e mai viste`} />
            <TesseraNumero titolo="Indirizzi IP" valore={r.ip} qualifica={`${totSilenziosi} silenziosi`}
              nota={`+${matrice.reti.reduce((a, x) => a + nuoviIn(x, 7), 0)} nuovi in 7 giorni, senza leggere il router`} />
          </div>

          {/* 1. Tutte le VLAN in poco spazio: si confrontano a colpo d'occhio. */}
          <Pannello numero={1} titolo="VLAN viste sul trunk" conteggio={iniziale.vlan.length} sottotitolo="Scegli una VLAN: sotto le sue reti"
            azioni={<Button size="sm" variant={vid == null ? "default" : "outline"} onClick={() => filtra({ vid: null, rete: null })}>Tutte</Button>}>
            {iniziale.vlan.length === 0 ? (
              <Vuoto titolo="Nessuna VLAN letta finora" testo="Il sensore manda le VLAN alla prima lettura, entro un paio di minuti dall'accensione." />
            ) : (
              <>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}>
                  {iniziale.vlan.map((v) => {
                    const rr = retiPerVid.get(v.vid) ?? [];
                    const ip = rr.reduce((a, x) => a + x.ip.length, 0);
                    const sil = rr.reduce((a, x) => a + silenziosi(x), 0);
                    return (
                      <VoceSelezionabile key={v.vid} scelta={vid === v.vid} className={cn("flex flex-col gap-1.5 p-2.5", !v.vista && "border-dashed")}
                        onScegli={() => filtra({ vid: vid === v.vid ? null : v.vid, rete: null })}>
                        <div className="flex items-baseline justify-between gap-1.5">
                          <span className="font-mono font-semibold">{nomeVlan(v.vid)}</span>
                          <span className="font-mono text-[13px] text-muted-foreground">{ip ? `${ip} IP` : v.mac ? `${v.mac} MAC` : "mai vista"}</span>
                        </div>
                        <div className="truncate text-[13px] text-muted-foreground">
                          {!v.dichiarata ? "▲ non dichiarata" : rr.length > 1 ? `${rr.length} reti` : rr.length === 1 ? rr[0].cidr : "nessuna rete"}
                        </div>
                        <Barra ascolto={ip - sil} silenziosi={sil} />
                      </VoceSelezionabile>
                    );
                  })}
                </div>
                <Legenda className="mt-3" voci={[
                  { classe: "bg-primary", testo: "IP in ascolto" },
                  { classe: "bg-[#0D2537] dark:bg-[#C8D3DA]", testo: "IP silenziosi" },
                  { classe: "bg-card border-dashed", testo: "bordo tratteggiato = dichiarata ma mai vista" },
                ]} />
              </>
            )}
          </Pannello>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* 2. Le reti, una voce ciascuna con la sua maschera. */}
            <Pannello numero={2} titolo="Reti" conteggio={retiVisibili.length}
              sottotitolo={`Una voce per rete, con la sua maschera · ${matrice.reti.filter((x) => retiIpam.includes(x.cidr)).length} in DA-IPAM, da ${blocchiVisti} blocchi visti`}
              azioni={vid != null ? <Etichetta tono="marca">{nomeVlan(vid)}</Etichetta> : undefined}>
              {retiVisibili.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {vid == null ? "Nessuna rete dedotta finora." : "Questa VLAN non ha IP: si vedono solo i MAC. Un giro ARP non serve finché non si conosce la rete."}
                </p>
              ) : (
                <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
                  {retiVisibili.map((x) => {
                    const altre = (vidPerCidr.get(x.cidr) ?? []).filter((v) => v !== x.vid);
                    return (
                      <VoceSelezionabile key={chiaveRete(x)} scelta={rete === chiaveRete(x)} className="flex flex-col gap-1.5 p-2.5"
                        onScegli={() => filtra({ rete: rete === chiaveRete(x) ? null : chiaveRete(x), vid: rete === chiaveRete(x) ? vid : x.vid })}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[15px] font-semibold">{x.cidr}</span>
                          <BadgeMaschera m={x.maschera} />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                          <span>
                            {vid == null && `${nomeVlan(x.vid)} · `}{x.ip.length} IP · gw <span className="font-mono">{x.gateway_ip ?? "—"}</span>
                          </span>
                          {nuoviOggi(x) > 0 && <Etichetta tono="ruolo">+{nuoviOggi(x)} oggi</Etichetta>}
                        </div>
                        {x.blocchi.length > 1 && (
                          <div className="text-[13px] text-muted-foreground">
                            unisce {x.blocchi.map((b) => <span key={b} className="font-mono text-foreground">{b.replace(/\.0\/24$/, ".x")} </span>)}
                          </div>
                        )}
                        {altre.length > 0 && (
                          <div><Etichetta tono="ruolo" mono={false}>▲ stessa rete anche su {altre.map(nomeVlan).join(", ")}</Etichetta></div>
                        )}
                      </VoceSelezionabile>
                    );
                  })}
                </div>
              )}
            </Pannello>

            {/* 3. Il dettaglio della rete scelta: le azioni stanno qui, una volta sola. */}
            {reteScelta ? (
              <Dettaglio key={chiaveRete(reteScelta)} rete={reteScelta} giorni={matrice.giorni} inIpam={retiIpam.includes(reteScelta.cidr)}
                giroDisabilitato={inCorso || !attiva} onGiro={() => void giroArp(reteScelta)} onPorta={() => void portaInIpam(reteScelta)}
                onMaschera={(p) => void correggiMaschera(reteScelta, p)} />
            ) : (
              <Pannello numero={3} titolo="Dettaglio della rete" conteggio="—">
                <p className="py-8 text-center text-[13px] text-muted-foreground">Scegli una rete a sinistra per vedere gateway, crescita e occupazione.</p>
              </Pannello>
            )}
          </div>

          {/* 4. L'elenco degli indirizzi: il centro della pagina, a tutta larghezza. */}
          <Pannello numero={4} titolo="Indirizzi IP e MAC" conteggio={totale}
            sottotitolo="Ogni indirizzo visto sul trunk, con il produttore della scheda e come è stato trovato"
            azioni={
              <>
                {(reteScelta || vid != null) && <Etichetta tono="marca">{reteScelta ? reteScelta.cidr : nomeVlan(vid as number)}</Etichetta>}
                <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="Come è stato trovato">
                  {METODI.map((m) => (
                    <button key={m.id} type="button" aria-pressed={metodo === m.id} onClick={() => filtra({ metodo: m.id })}
                      className={cn("min-h-8 px-2.5 text-[13px]", metodo === m.id ? "bg-primary font-semibold text-[#0D2537]" : "bg-card hover:bg-muted/50")}>
                      {m.etichetta}
                    </button>
                  ))}
                </div>
                <div className="relative w-64 max-w-full">
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                  <Input className="h-8 pl-8" placeholder="Cerca IP, MAC, nome" value={q} onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") filtra({ q }); }} />
                </div>
              </>
            }>
            <div className="space-y-3">
              {errore && <LoadError what="gli indirizzi del trunk" message={errore} onRetry={() => filtra({ off: offset })} />}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Indirizzo IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Produttore</TableHead>
                      <TableHead>VLAN · rete</TableHead>
                      <TableHead>Come è stato trovato</TableHead>
                      <TableHead>Nome e protocolli</TableHead>
                      <TableHead>Ultimo visto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {righe.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nessun indirizzo con questi filtri.</TableCell></TableRow>
                    )}
                    {righe.map((o) => {
                      const sub = reteDi(o);
                      const gw = sub && sub.gateway_ip === o.ip;
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="whitespace-nowrap font-mono font-semibold">
                            {o.ip || "—"}
                            {gw && (
                              <Etichetta tono="ruolo" className="ml-2">
                                <span title={sub.fonte === "dhcp" ? "Gateway annunciato dal DHCP" : "IP più cercato con ARP"}>{sub.fonte === "dhcp" ? "GW" : "GW?"}</span>
                              </Etichetta>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[13px]">{o.mac_display}</TableCell>
                          <TableCell className="max-w-44 truncate" title={o.vendor ?? undefined}>{o.vendor ?? <span className="text-muted-foreground">sconosciuto</span>}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-[13px]">
                            <span className="text-cian-testo">{nomeVlan(o.vid)}</span>
                            {sub && ` · ${sub.cidr}`}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[13px] font-medium"><Come passivo={o.passivo} attivo={o.attivo} /></TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              {o.nome ? <span className="mr-1 font-mono text-[13px]">{o.nome}</span> : <span className="mr-1 text-muted-foreground">—</span>}
                              {o.protocolli.map((x) => <Etichetta key={x}>{x}</Etichetta>)}
                              {o.rilievi.filter((t) => SEGNO_RILIEVO[t]).map((t) => (
                                <Etichetta key={t} tono={t === "non_in_inventario" || t === "piu_vlan" ? "neutro" : "ruolo"} mono={false}>
                                  <span title={TIPI_RILIEVO[t].cosaFare}>{SEGNO_RILIEVO[t]}</span>
                                </Etichetta>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground" title={o.ultima_vista}>{fa(o.ultima_vista)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                  <span>● visto in ascolto</span>
                  <span>▲ silenzioso, trovato solo col giro ARP</span>
                  <span>◆ visto e confermato</span>
                  <span><Etichetta tono="ruolo">GW?</Etichetta> IP più cercato</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => filtra({ off: Math.max(offset - PAGINA, 0) })}>Precedenti</Button>
                  <span className="text-muted-foreground">{totale === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGINA, totale)}`} di {totale}</span>
                  <Button size="sm" variant="outline" disabled={offset + PAGINA >= totale} onClick={() => filtra({ off: offset + PAGINA })}>Successivi</Button>
                </div>
              </div>
            </div>
          </Pannello>
        </div>
      )}
    </div>
  );
}

/** Una riga in parole semplici: la sonda gira? DA-IPAM riceve i dati? Se no, perché. */
function StatoLettura({ attiva, sonda, esito, aggiornato }: {
  attiva: boolean; sonda: TrunkStatoSonda; esito: TrunkEsitoLettura | null; aggiornato: string | null;
}) {
  let segno: "✓" | "▲" | "✕";
  let testo: string;
  if (!sonda.raggiungibile) {
    segno = "✕";
    testo = `La sonda non risponde: ${sonda.errore ?? "motivo sconosciuto"}. Su questa macchina non è installata o è spenta; serve una seconda scheda di rete collegata alla porta trunk.`;
  } else if (!sonda.inAscolto) {
    segno = "✕";
    testo = `La sonda è installata ma non ascolta${sonda.errore ? `: ${sonda.errore}` : ""}.`;
  } else if (!sonda.tagLetti) {
    segno = "▲";
    testo = "La sonda ascolta ma non ha ancora visto pacchetti con il tag VLAN: la porta dello switch forse non è configurata come trunk.";
  } else if (!attiva) {
    segno = "▲";
    testo = "La sonda funziona, ma DA-IPAM non legge i suoi dati: accendi la lettura in Opzioni.";
  } else if (esito && esito.esito !== "ok") {
    segno = "▲";
    testo = `Ultima lettura ${fa(esito.quando)} non riuscita: ${esito.nota}`;
  } else {
    segno = "✓";
    testo = `Funziona. Dati ricevuti ${fa(esito?.quando ?? aggiornato)}; DA-IPAM legge ogni 2 minuti.`;
  }
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm",
      segno === "✓" ? "border-[#1F7A4D] bg-card" : segno === "▲" ? "border-[#C9A800] bg-[#FFD400]/15" : "border-[#8E1B20] bg-card")}>
      <span aria-hidden className={cn("font-bold", segno === "✓" ? "text-[#1F7A4D]" : segno === "✕" ? "text-[#8E1B20] dark:text-[#F07178]" : "")}>{segno}</span>
      <span>{testo}</span>
    </div>
  );
}

function Barra({ ascolto, silenziosi: sil }: { ascolto: number; silenziosi: number }) {
  const tot = ascolto + sil;
  return (
    <div className="flex h-1.5 min-w-14 overflow-hidden rounded-full bg-muted" title={`${ascolto} in ascolto, ${sil} silenziosi`}>
      {tot > 0 && <div className="bg-primary" style={{ width: `${(ascolto / tot) * 100}%` }} />}
      {tot > 0 && <div className="bg-[#0D2537] dark:bg-[#C8D3DA]" style={{ width: `${(sil / tot) * 100}%` }} />}
    </div>
  );
}

function BadgeMaschera({ m }: { m: TrunkMaschera }) {
  const s = MASCHERA[m];
  return (
    <span title={s.spiega} className={cn("inline-block whitespace-nowrap rounded-md border-[1.5px] px-1.5 text-[13px] font-semibold leading-[21px]", s.classe)}>
      {s.testo}
    </span>
  );
}

function Come({ passivo, attivo }: { passivo: number; attivo: number }) {
  if (passivo && attivo) return <span><span className="text-primary">◆</span> ascolto + giro ARP</span>;
  if (attivo) return <span>▲ solo col giro ARP</span>;
  return <span><span className="text-primary">●</span> visto in ascolto</span>;
}

function Dettaglio({ rete, giorni, inIpam, giroDisabilitato, onGiro, onPorta, onMaschera }: {
  rete: TrunkReteMatrice; giorni: string[]; inIpam: boolean; giroDisabilitato: boolean;
  onGiro: () => void; onPorta: () => void; onMaschera: (prefisso: number | null) => void;
}) {
  const sil = silenziosi(rete);
  const gw = rete.gateway_ip ? rete.ip.find((i) => i.ip === rete.gateway_ip) : undefined;
  const prefisso = Number(rete.cidr.split("/")[1]);
  const perche: Record<TrunkMaschera, string> = {
    dhcp: "annunciata dal DHCP",
    dedotta: rete.blocchi.length > 1 ? `dedotta: ${rete.blocchi.length} blocchi vicini con lo stesso gateway` : "dedotta dagli IP visti",
    incerta: `IP sparsi in ${rete.blocchi.length} blocchi: confermala prima di portarla in DA-IPAM`,
    config: `scritta a mano (dedotta: ${rete.dedotta})`,
  };
  return (
    <Pannello numero={3} titolo={`Rete ${rete.cidr}`} conteggio={rete.ip.length} azioni={<Etichetta tono="marca">{nomeVlan(rete.vid)}</Etichetta>}>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <Dato nome="Gateway" valore={`${rete.gateway_ip ?? "—"}${gw?.vendor ? ` · ${gw.vendor}` : ""}`} />
        <Dato nome="Indirizzi" valore={`${rete.ip.length} (${sil} silenziosi)`} />
        <Dato nome="Nuovi in 7 giorni" valore={`+${nuoviIn(rete, 7)}`} />
        <Dato nome="Maschera" valore={`/${prefisso}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <BadgeMaschera m={rete.maschera} />
        <span>{perche[rete.maschera]}</span>
        {rete.maschera !== "dhcp" && (
          <label className="ml-1 flex items-center gap-1.5">
            correggi
            <select value={prefisso} onChange={(e) => onMaschera(Number(e.target.value))}
              className="h-8 rounded-md border bg-card px-2 font-mono text-[13px] text-foreground">
              {[...new Set([...PREFISSI, prefisso])].sort((a, b) => a - b).map((p) => <option key={p} value={p}>/{p}</option>)}
            </select>
          </label>
        )}
        {rete.maschera === "config" && (
          <Button size="sm" variant="outline" onClick={() => onMaschera(null)}>Torna alla dedotta</Button>
        )}
      </div>

      <p className="mt-4 mb-1 text-[13px] font-bold uppercase tracking-wider text-cian-testo">IP conosciuti negli ultimi {giorni.length} giorni</p>
      <Grafico rete={rete} giorni={giorni} />

      <p className="mt-4 text-[13px] font-bold uppercase tracking-wider text-cian-testo">Occupazione</p>
      <Occupazione rete={rete} />

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" className="border-[#C9A800]" disabled={giroDisabilitato} onClick={onGiro}
          title="Trova gli apparati che non parlano: stampanti, PLC, telecamere">
          <Zap className="h-4 w-4" /> Giro ARP
        </Button>
        {inIpam ? <Etichetta mono={false}>✓ in DA-IPAM</Etichetta> : (
          <Button size="sm" onClick={onPorta} className="text-[#0D2537]" title={rete.maschera === "incerta" ? "La maschera è incerta: correggila prima" : undefined}>
            Porta in DA-IPAM
          </Button>
        )}
      </div>
    </Pannello>
  );
}

function Dato({ nome, valore }: { nome: string; valore: string }) {
  return (
    <div>
      <div className="text-[13px] text-muted-foreground">{nome}</div>
      <div className="font-mono text-[15px] font-semibold">{valore}</div>
    </div>
  );
}

/** Linea = IP conosciuti (cumulato), barre gialle = nuovi quel giorno. */
function Grafico({ rete, giorni }: { rete: TrunkReteMatrice; giorni: string[] }) {
  const W = 560, H = 160, pl = 34, pb = 22, pt = 22;
  const serie = rete.serie;
  const max = Math.max(1, ...serie.map((g) => g.noti));
  const top = Math.ceil(max / 10) * 10;
  const bw = (W - pl - 8) / Math.max(serie.length, 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / top);
  const cx = (k: number) => pl + bw * k + bw / 2;
  const punti = serie.map((g, k) => `${cx(k).toFixed(1)},${y(g.noti).toFixed(1)}`).join(" ");
  const ultimo = serie.length ? serie[serie.length - 1] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="IP conosciuti per giorno">
        {[0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - 6} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray={t ? "3 3" : undefined} />
            <text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize={12} className="fill-muted-foreground font-mono">{t}</text>
          </g>
        ))}
        {serie.map((g, k) => (
          <g key={g.giorno}>
            {g.nuovi > 0 && (
              <rect x={cx(k) - bw * 0.3} y={y(g.nuovi)} width={bw * 0.6} height={y(0) - y(g.nuovi)} rx={2} fill="#FFD400" stroke="#C9A800">
                <title>{`${g.giorno}: ${g.nuovi} nuovi`}</title>
              </rect>
            )}
            {(k % 2 === 1 || k === serie.length - 1) && (
              <text x={cx(k)} y={H - 6} textAnchor="middle" fontSize={12} className="fill-muted-foreground font-mono">{g.giorno.slice(8, 10)}</text>
            )}
          </g>
        ))}
        {serie.length > 1 && <polyline points={punti} fill="none" stroke="#00A7E7" strokeWidth={2.2} strokeLinejoin="round" />}
        {ultimo && (
          <>
            <circle cx={cx(serie.length - 1)} cy={y(ultimo.noti)} r={4} fill="#00A7E7" />
            <text x={cx(serie.length - 1) - 8} y={y(ultimo.noti) - 8} textAnchor="end" fontSize={13} fontWeight={600} className="fill-foreground font-mono">{ultimo.noti}</text>
          </>
        )}
      </svg>
      <Legenda voci={[
        { classe: "bg-primary", testo: "IP conosciuti (cumulato)" },
        { classe: "bg-[#FFD400] border-[#C9A800]", testo: "nuovi quel giorno" },
        { classe: "bg-card", testo: `dal ${giorni[0]?.slice(8, 10) ?? ""}/${giorni[0]?.slice(5, 7) ?? ""}` },
      ]} />
    </div>
  );
}

/** Una griglia da 64 caselle per ogni /24 (o per la rete, se più piccola). */
function Occupazione({ rete }: { rete: TrunkReteMatrice }) {
  const prefisso = Number(rete.cidr.split("/")[1]);
  const perIp = new Map(rete.ip.map((i) => [i.ip, i]));
  const base24 = (c: string) => c.split("/")[0].split(".").slice(0, 3).join(".");
  const blocchi = prefisso >= 24
    ? [{ base: ipNumero(rete.cidr.split("/")[0]), dim: 2 ** (32 - prefisso) }]
    : [...new Set([...rete.blocchi.map(base24), ...rete.ip.map((i) => i.ip.split(".").slice(0, 3).join("."))])]
      .sort((a, b) => ipNumero(`${a}.0`) - ipNumero(`${b}.0`))
      .slice(0, 8)
      .map((b) => ({ base: ipNumero(`${b}.0`), dim: 256 }));
  const nIp = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join(".");
  return (
    <div>
      {blocchi.map(({ base, dim }) => {
        const passo = Math.max(1, Math.round(Math.min(dim, 256) / 64));
        return (
          <div key={base}>
            <div className="mt-2 mb-1 font-mono text-[13px] text-muted-foreground">
              {nIp(base)}/{dim === 256 ? 24 : prefisso} · una casella = {passo === 1 ? "1 indirizzo" : `${passo} indirizzi`}
            </div>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(64, minmax(0, 1fr))" }}>
              {Array.from({ length: 64 }, (_, c) => {
                if (c * passo >= dim) return <i key={c} className="block aspect-square rounded-[2px] bg-muted opacity-25" />;
                let tipo: "vuoto" | "ascolto" | "giro" | "gw" = "vuoto";
                for (let k = 0; k < passo; k++) {
                  const ip = nIp(base + c * passo + k);
                  const x = perIp.get(ip);
                  if (ip === rete.gateway_ip && x) { tipo = "gw"; break; }
                  if (x) tipo = x.passivo ? "ascolto" : tipo === "ascolto" ? "ascolto" : "giro";
                }
                return (
                  <i key={c} title={passo === 1 ? nIp(base + c) : undefined} className={cn("block aspect-square rounded-[2px]", {
                    vuoto: "bg-muted", ascolto: "bg-primary", giro: "bg-[#0D2537] dark:bg-[#C8D3DA]", gw: "bg-[#FFD400] outline outline-1 outline-[#C9A800]",
                  }[tipo])} />
                );
              })}
            </div>
          </div>
        );
      })}
      <Legenda className="mt-2" voci={[
        { classe: "bg-primary", testo: "in ascolto" },
        { classe: "bg-[#0D2537] dark:bg-[#C8D3DA]", testo: "silenzioso" },
        { classe: "bg-[#FFD400] border-[#C9A800]", testo: "gateway" },
        { classe: "bg-muted", testo: "mai visto" },
      ]} />
    </div>
  );
}
