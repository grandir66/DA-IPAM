"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import {
  BarraStato, Etichetta, Legenda, Pannello, TesseraNumero, VoceSelezionabile, Vuoto,
} from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { ETICHETTA_APPARTENENZA, type Appartenenza, type FiltroAppartenenza, type TagAppartenenza } from "@/lib/trunk/appartenenza";
import type {
  TrunkAppartenenzaQuadro, TrunkEsitoLettura, TrunkMetodo, TrunkOsservazioneRiga, TrunkStatoSonda, TrunkReteMatrice, TrunkVlanProtocolli, TrunkVlanRiga,
} from "@/lib/trunk/sensore-trunk";
import type { PuntoAscolto } from "@/lib/traffico/reti-collector";
import { TIPI_RILIEVO, type TipoRilievo } from "@/lib/trunk/rilievi-tipi";
import { PannelloRilievi, type DatiRilievi } from "./rilievi-pannello";
import { PannelloAnnunci } from "./annunci-pannello";
import { BadgeMaschera, Barra, Dettaglio, fa, ipNumero, nomeVlan, nuoviIn, nuoviOggi, silenziosi } from "./pezzi-rete";
import { RetiCollector } from "./reti-collector";

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
  appartenenza: TrunkAppartenenzaQuadro;
  /** I collector per sede: gli altri punti di ascolto (25/11). */
  punti: PuntoAscolto[];
}

/** Il filtro «appartenenza»: di serie tutto tranne gli instradati, che non sono host della VLAN (08/11). */
const FILTRI_APPARTENENZA: Array<{ id: FiltroAppartenenza; etichetta: string; tag?: TagAppartenenza[] }> = [
  { id: "", etichetta: "Tutti" },
  { id: "ufficiale", etichetta: "✓ Ufficiali", tag: ["ufficiale"] },
  { id: "altri", etichetta: "Altri", tag: ["altra_vlan", "fuori_rete", "vlan_non_ipam", "pubblico", "link_local"] },
  { id: "altra_vlan", etichetta: "▲ Altra VLAN", tag: ["altra_vlan"] },
  { id: "vlan_non_ipam", etichetta: "● VLAN non in DA-IPAM", tag: ["vlan_non_ipam"] },
  { id: "link_local", etichetta: "● 169.254", tag: ["link_local"] },
  { id: "instradato", etichetta: "– Instradati", tag: ["instradato"] },
];

const CLASSE_TONO: Record<"ok" | "attenzione" | "neutro" | "tratteggio", string> = {
  ok: "bg-[#1F7A4D] text-white border-[#1F7A4D]",
  attenzione: "bg-[#FFD400] text-[#0D2537] border-[#C9A800]",
  neutro: "bg-[#5B6B77] text-white border-[#5B6B77]",
  tratteggio: "border-dashed border-muted-foreground text-muted-foreground",
};

function BadgeAppartenenza({ a }: { a: Appartenenza | null }) {
  if (!a) return <span className="text-muted-foreground">—</span>;
  const e = ETICHETTA_APPARTENENZA[a.tag];
  const dove = a.tag === "altra_vlan" && a.rete ? ` · ${a.rete} è ${a.vlan != null ? `la VLAN ${a.vlan}` : "senza VLAN"} in DA-IPAM` : "";
  return (
    <span title={e.spiega} className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[13px]", CLASSE_TONO[e.tono])}>
      {e.segno} {e.testo}{dove}
    </span>
  );
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

const chiaveRete = (r: { vid: number; cidr: string }) => `${r.vid}-${r.cidr}`;

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const blocco = 2 ** (32 - Number(bits));
  return Math.floor(ipNumero(ip) / blocco) === Math.floor(ipNumero(base) / blocco);
}

type Scheda = "sicurezza" | "reti" | "annunci";

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
  const [quadro, setQuadro] = useState<TrunkAppartenenzaQuadro>(iniziale.appartenenza);
  const [filtroApp, setFiltroApp] = useState<FiltroAppartenenza>("");
  // Da dove si ascolta (25/11): la sonda trunk, o i collector di una sede. Senza sonda si parte dai collector.
  const conTrunk = attiva || sonda.raggiungibile || iniziale.vlan.length > 0;
  const [punto, setPunto] = useState<string | null>(conTrunk ? null : iniziale.punti[0]?.sede ?? null);
  const puntoScelto = iniziale.punti.find((p) => p.sede === punto) ?? null;
  const nativa = quadro.nativa.usata;
  const etichettaVlan = (v: number) => (v === 0 && nativa != null ? `Nativa · VLAN ${nativa}` : nomeVlan(v));
  const numeriVlan = useMemo(() => new Map(quadro.perVlan.map((x) => [x.vid, x])), [quadro.perVlan]);
  // Due schede (Riccardo, 25/10: in una pagina sola diventava troppo lunga). La scheda sta nell'indirizzo
  // (#sicurezza, #reti), così il badge del menu e un collegamento aprono quella giusta.
  const [scheda, setScheda] = useState<Scheda>("sicurezza");
  // Dal 13/11/2026 le tre parti si scelgono dalla fila di schede in cima (components/shared/schede-sezione.tsx), che
  // cambia l'àncora: qui la si segue.
  useEffect(() => {
    const leggi = () => {
      const h = window.location.hash.slice(1);
      setScheda(h === "reti" || h === "annunci" ? h : "sicurezza");
    };
    leggi();
    window.addEventListener("hashchange", leggi);
    return () => window.removeEventListener("hashchange", leggi);
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

  const carica = useCallback(async (filtro: { vid: number | null; rete: TrunkReteMatrice | null; metodo: TrunkMetodo | ""; q: string; off: number; app: FiltroAppartenenza }) => {
    const p = new URLSearchParams({ limit: String(PAGINA), offset: String(filtro.off) });
    if (filtro.app) p.set("appartenenza", filtro.app);
    if (filtro.vid != null) p.set("vid", String(filtro.vid));
    if (filtro.rete) p.set("cidr", filtro.rete.cidr);
    if (filtro.metodo) p.set("metodo", filtro.metodo);
    if (filtro.q.trim()) p.set("q", filtro.q.trim());
    const res = await fetchJson<{ osservazioni: TrunkOsservazioneRiga[]; totale: number; appartenenza: TrunkAppartenenzaQuadro }>(`/api/trunk?${p.toString()}`);
    if (!res.ok) {
      setErrore(res.message);
      return;
    }
    setErrore(null);
    setQuadro(res.data.appartenenza);
    setRighe(res.data.osservazioni);
    setTotale(res.data.totale);
    setOffset(filtro.off);
  }, []);

  const filtra = (cambi: Partial<{ vid: number | null; rete: string | null; metodo: TrunkMetodo | ""; q: string; off: number; app: FiltroAppartenenza }>) => {
    const nuovo = { vid, rete, metodo, q, off: 0, app: filtroApp, ...cambi };
    setVid(nuovo.vid);
    setRete(nuovo.rete);
    setMetodo(nuovo.metodo);
    setFiltroApp(nuovo.app);
    void carica({ ...nuovo, rete: matrice.reti.find((x) => chiaveRete(x) === nuovo.rete) ?? null });
  };

  /** La VLAN dei pacchetti senza tag: confermata da chi usa la pagina (numero, «nessuna», o null = torna alla dedotta). */
  const salvaNativa = async (scelta: number | "nessuna" | null) => {
    const res = await fetchJson<{ appartenenza: TrunkAppartenenzaQuadro }>("/api/trunk/vlan-nativa", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vid: scelta }),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setQuadro(res.data.appartenenza);
    toast.success(scelta == null ? "Si torna alla VLAN nativa dedotta" : scelta === "nessuna" ? "Nessuna VLAN nativa" : `VLAN nativa: ${scelta}`);
    filtra({ off: 0 });
    router.refresh();
  };

  const portaInIpam = async (x: TrunkReteMatrice) => {
    setInCorso(true);
    const attesa = toast.loading(`Rete ${x.cidr}: giro ARP sulla VLAN e host trovati (fino a un minuto e mezzo)…`);
    try {
      const res = await fetchJson<{ id: number; host: { creati: number; mac: number }; giro: string }>("/api/trunk/rete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vid: x.vid, cidr: x.cidr, gateway: x.fonte === "dhcp" ? x.gateway_ip : null }),
      });
      if (!res.ok) {
        toast.error(res.message, { id: attesa });
        return;
      }
      setRetiIpam((l) => [...l, x.cidr]);
      toast.success(`Rete ${x.cidr} creata in DA-IPAM con ${res.data.host.creati} host dal trunk · ${res.data.giro}`, { id: attesa });
      router.refresh();
    } finally {
      setInCorso(false);
    }
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
  const statoLettura = leggiStato(attiva, sonda, ultimoEsito);
  const totSilenziosi = matrice.reti.reduce((a, x) => a + silenziosi(x), 0);

  return (
    <div className="space-y-4">
      {scheda === "reti" && iniziale.punti.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Punto di ascolto">
          <span className="mr-1 text-[13px] text-muted-foreground">Da dove si ascolta:</span>
          {conTrunk && <Button variant={punto === null ? "default" : "outline"} aria-pressed={punto === null} onClick={() => setPunto(null)}>Sonda trunk</Button>}
          {iniziale.punti.map((p) => (
            <Button key={p.sede} variant={punto === p.sede ? "default" : "outline"} aria-pressed={punto === p.sede} title={p.collector.join(", ")} onClick={() => setPunto(p.sede)}>
              {p.sede} · {p.collector.length === 1 ? "1 collector" : `${p.collector.length} collector`}
            </Button>
          ))}
        </div>
      )}
      {scheda === "reti" && puntoScelto && <RetiCollector key={puntoScelto.sede} punto={puntoScelto} admin={admin} />}
      {!(scheda === "reti" && puntoScelto) && (
        <>
          <BarraStato
            acceso={sonda.raggiungibile && sonda.inAscolto}
            titolo="Sonda trunk"
            dettagli={sonda.raggiungibile ? [
              sonda.nic ? `scheda ${sonda.nic}` : "scheda non indicata",
              sonda.pacchettiAlSecondo != null ? `${Math.round(sonda.pacchettiAlSecondo)} pacchetti/s` : "traffico non misurato",
              sonda.tagLetti ? "tag VLAN letti" : "nessun tag VLAN visto",
              `letta dal ${sonda.fonte === "socket" ? "socket locale" : "Scanner-Edge"}`,
              ...(statoLettura.segno === "✓" ? [`dati ${fa(ultimoEsito?.quando ?? r.aggiornato)}`] : []),
            ] : ["non risponde"]}
            azioni={
              <Button size="sm" variant={attiva ? "outline" : "default"} render={<Link href="/settings/opzioni#modulo.sensore_trunk" />}>
                {attiva ? "Impostazioni" : "Accendi in Opzioni"}
              </Button>
            }
          />
          {statoLettura.segno !== "✓" && <AvvisoLettura {...statoLettura} />}
        </>
      )}

      {scheda === "sicurezza" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TesseraNumero titolo="Allarmi" valore={ril.allarmi}
              qualifica={ril.allarmiAlti ? `✕ ${ril.allarmiAlti} gravi da prendere` : "nessuno grave aperto"} nota="DHCP, IP contesi, indirizzi fuori rete" />
            <TesseraNumero titolo="Esposizioni" valore={ril.esposizioni}
              qualifica={`${esposizioniLlmnr} con LLMNR/NetBIOS`} nota="come è fatta la rete, con cosa fare" />
            <TesseraNumero titolo="Novità" valore={ril.novita} nota="apparati sconosciuti sentiti sulla rete" />
            <TesseraNumero titolo="Da prendere in carico" valore={ril.perTipo.reduce((a, t) => a + t.daPrendere, 0)} nota="senza nessuno che se ne occupa" />
          </div>
          <PannelloRilievi iniziale={iniziale.rilievi} admin={admin} />
        </div>
      )}

      {scheda === "annunci" && <PannelloAnnunci />}

      {scheda === "reti" && !puntoScelto && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TesseraNumero titolo="VLAN viste" valore={iniziale.vlan.filter((v) => v.vista).length}
              qualifica={`${nonDichiarate} non dichiarate`} nota={`${maiViste} dichiarate e mai viste`} />
            <TesseraNumero titolo="Reti" valore={matrice.reti.length}
              qualifica={`${matrice.reti.filter((x) => retiIpam.includes(x.cidr)).length} in DA-IPAM`} nota="dedotte dagli indirizzi visti" />
            <TesseraNumero titolo="Indirizzi IP" valore={r.ip} qualifica={`${totSilenziosi} silenziosi`} nota="visti senza leggere il router" />
            <TesseraNumero titolo="Nuovi in 7 giorni" valore={matrice.reti.reduce((a, x) => a + nuoviIn(x, 7), 0)} nota="indirizzi mai visti prima" />
          </div>

          {/* VLAN nativa: i pacchetti senza tag arrivano come VID 0, in DA-IPAM la stessa rete ha la sua VLAN (08/11). */}
          {quadro.nativa.confermata == null && (quadro.nativa.dedotta || numeriVlan.has(0)) && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#C9A800] bg-[#FFD400] px-3 py-2.5 text-[13px] text-[#0D2537]">
              <span className="font-semibold">▲ VLAN nativa da confermare</span>
              <span className="min-w-[220px] flex-1">
                {quadro.nativa.dedotta
                  ? <>I pacchetti senza tag sono la <strong>VLAN {quadro.nativa.dedotta.vid}</strong>? {quadro.nativa.dedotta.dentro} IP senza tag su {quadro.nativa.dedotta.totale} stanno in {quadro.nativa.dedotta.rete}. Intanto la pagina li legge così.</>
                  : <>Gli IP senza tag non stanno in nessuna rete con VLAN di DA-IPAM: la pagina li tiene a parte.</>}
              </span>
              {admin && quadro.nativa.dedotta && (
                <Button size="sm" variant="outline" className="bg-card" onClick={() => void salvaNativa(quadro.nativa.dedotta?.vid ?? null)}>
                  Sì, è la VLAN {quadro.nativa.dedotta.vid}
                </Button>
              )}
              {admin && (
                <Button size="sm" variant="outline" className="bg-card" onClick={() => {
                  const v = window.prompt("Numero della VLAN nativa del trunk (1-4094), oppure vuoto per «nessuna»:", "");
                  if (v == null) return;
                  const n = Number(v.trim());
                  if (v.trim() === "") void salvaNativa("nessuna");
                  else if (Number.isInteger(n) && n >= 1 && n <= 4094) void salvaNativa(n);
                  else toast.error("Scrivi un numero da 1 a 4094");
                }}>
                  È un&apos;altra
                </Button>
              )}
            </div>
          )}

          {/* 1. Tutte le VLAN in poco spazio: si confrontano a colpo d'occhio. */}
          <Pannello numero={1} titolo="VLAN viste sul trunk" conteggio={iniziale.vlan.length} sottotitolo="Scegli una VLAN: sotto le sue reti"
            azioni={
              <>
                {quadro.nativa.confermata != null && (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    Senza tag = {quadro.nativa.confermata === "nessuna" ? "nessuna VLAN" : `VLAN ${quadro.nativa.confermata}`}
                    {admin && <Button size="sm" variant="ghost" className="h-7 px-2 text-[13px]" onClick={() => void salvaNativa(null)}>Cambia</Button>}
                  </span>
                )}
                <Button size="sm" variant={vid == null ? "default" : "outline"} onClick={() => filtra({ vid: null, rete: null })}>Tutte</Button>
              </>
            }>
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
                          <span className="font-mono font-semibold">{etichettaVlan(v.vid)}</span>
                          <span className="font-mono text-[13px] text-muted-foreground">{ip ? `${ip} IP` : v.mac ? `${v.mac} MAC` : "mai vista"}</span>
                        </div>
                        <div className="truncate text-[13px] text-muted-foreground">
                          {!v.dichiarata ? "▲ non dichiarata" : rr.length > 1 ? `${rr.length} reti` : rr.length === 1 ? rr[0].cidr : "nessuna rete"}
                        </div>
                        <Barra ascolto={ip - sil} silenziosi={sil} />
                        {numeriVlan.has(v.vid) && (
                          <div className="text-[13px]">
                            <span title="IP nella rete dichiarata in DA-IPAM per questa VLAN">✓ {numeriVlan.get(v.vid)?.ufficiali ?? 0} ufficiali</span>
                            <span className="text-muted-foreground" title="IP fuori dalla rete della VLAN (gli instradati non contano)"> · {numeriVlan.get(v.vid)?.altri ?? 0} altri</span>
                          </div>
                        )}
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
                giroDisabilitato={inCorso || !attiva} portaDisabilitata={inCorso} onGiro={() => void giroArp(reteScelta)} onPorta={() => void portaInIpam(reteScelta)}
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
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Appartenenza">
                <span className="mr-1 text-[13px] text-muted-foreground">Appartenenza:</span>
                {FILTRI_APPARTENENZA.map((f) => {
                  const n = f.tag ? f.tag.reduce((a, t) => a + (quadro.totali[t] ?? 0), 0) : null;
                  return (
                    <button key={f.id || "tutti"} type="button" aria-pressed={filtroApp === f.id} onClick={() => filtra({ app: f.id })}
                      className={cn("min-h-8 rounded-lg border px-2.5 text-[13px]", filtroApp === f.id ? "border-primary bg-primary font-semibold text-[#0D2537]" : "bg-card hover:bg-muted/50",
                        f.id === "instradato" && filtroApp !== f.id && "border-dashed")}>
                      {f.etichetta}{n != null ? ` ${n}` : ""}
                    </button>
                  );
                })}
                {filtroApp === "" && (quadro.totali.instradato ?? 0) > 0 && (
                  <span className="text-[13px] text-muted-foreground">· {quadro.totali.instradato} instradati nascosti</span>
                )}
              </div>
              {errore && <LoadError what="gli indirizzi del trunk" message={errore} onRetry={() => filtra({ off: offset })} />}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Indirizzo IP</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Produttore</TableHead>
                      <TableHead>VLAN · rete</TableHead>
                      <TableHead>Appartenenza</TableHead>
                      <TableHead>Come è stato trovato</TableHead>
                      <TableHead>Nome e protocolli</TableHead>
                      <TableHead>Ultimo visto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {righe.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nessun indirizzo con questi filtri.</TableCell></TableRow>
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
                            <span className="text-cian-testo">{etichettaVlan(o.vid)}</span>
                            {sub && ` · ${sub.cidr}`}
                          </TableCell>
                          <TableCell><BadgeAppartenenza a={o.appartenenza} /></TableCell>
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
                            {/* Cosa l'oggetto dice di sé in modo passivo: annunci (MNDP, Ubiquiti, CDP) e dichiarazioni (SSDP, mDNS, DHCP). */}
                            {o.dichiara.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
                                {o.dichiara.map((x) => (
                                  <span key={`${x.come}|${x.valore}`}>
                                    <span className="text-muted-foreground">{x.come}</span> <span className="font-mono">{x.valore}</span>
                                  </span>
                                ))}
                              </div>
                            )}
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

interface StatoLettura { segno: "✓" | "▲" | "✕"; testo: string }

/** La sonda gira? DA-IPAM riceve i dati? Se no, perché. Quando va tutto bene basta la barra, senza una riga in più. */
function leggiStato(attiva: boolean, sonda: TrunkStatoSonda, esito: TrunkEsitoLettura | null): StatoLettura {
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
    testo = "";
  }
  return { segno, testo };
}

function AvvisoLettura({ segno, testo }: StatoLettura) {
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm",
      segno === "▲" ? "border-[#C9A800] bg-[#FFD400]/15" : "border-[#8E1B20] bg-card")}>
      <span aria-hidden className={cn("font-bold", segno === "✕" ? "text-[#8E1B20] dark:text-[#F07178]" : "")}>{segno}</span>
      <span>{testo}</span>
    </div>
  );
}

function Come({ passivo, attivo }: { passivo: number; attivo: number }) {
  if (passivo && attivo) return <span><span className="text-primary">◆</span> ascolto + giro ARP</span>;
  if (attivo) return <span>▲ solo col giro ARP</span>;
  return <span><span className="text-primary">●</span> visto in ascolto</span>;
}

