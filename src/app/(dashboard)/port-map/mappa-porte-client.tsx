"use client";
/** Mappa porte (piano 2026-11-07): cosa c'è sulla rete e su quale porta sta, con quanta certezza e perché. */
import Link from "next/link";
import { EthernetPort } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BarraStato, DatoDettaglio, IntestazionePagina, Pannello, SchedaDettaglio, SchedePagina, TesseraNumero, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { parseDbDate } from "@/lib/db-date";
import { fetchJson } from "@/lib/fetch-json";
import type { StatoCalcolo, VoceRotta, VoceSpostamento } from "@/lib/mappa-porte/calcolo";
import type { Confidenza, OggettoMappa, PortaMappa, TipoPorta } from "@/lib/mappa-porte/tipi";
import { MODI, TabellaPorte, Testata, TIPI_PORTA, type OrdinamentoTabella } from "@/components/mappa-porte/tabella-porte";
import type { SortDirection } from "@/components/shared/sortable-table-head";

type Scheda = "oggetti" | "porte" | "rotte";
interface Risposta<T> { righe: T[]; totale: number; dimensionePagina: number; calcolo: StatoCalcolo | null; apparati: Array<{ id: number; nome: string }>; vlan: number[] }

const CONFIDENZE: Record<Confidenza, { segno: string; testo: string; classi: string; spiega: string }> = {
  certa: { segno: "●", testo: "Certa", classi: STILE_STATO.ok.classi, spiega: "Lo dice il controller, oppure è l'unico MAC sulla porta" },
  spiegata: { segno: "◐", testo: "Spiegata", classi: STILE_STATO.da_verificare.classi, spiega: "Porta condivisa con un motivo: hypervisor, telefono + PC" },
  da_capire: { segno: "○", testo: "Da capire", classi: STILE_STATO.attenzione.classi, spiega: "Più MAC senza motivo, forse uno switch non gestito, o due porte insieme" },
  non_so: { segno: "✕", testo: "Non so", classi: STILE_STATO.grigio.classi, spiega: "Visto solo su porte di passaggio: si dice il ramo, non si indovina la porta" },
};
const TIPI_ELENCO = Object.entries(TIPI_PORTA) as Array<[TipoPorta, string]>;
const CLASSE_SCELTA = "h-9 rounded-md border bg-background px-2 text-sm";

const quando = (s: string | null | undefined): string => (s ? parseDbDate(s).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—");

function SegnoConfidenza({ c }: { c: Confidenza }) {
  const v = CONFIDENZE[c];
  return (
    <span title={v.spiega} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] leading-none font-semibold whitespace-nowrap ${v.classi}`}>
      <span aria-hidden>{v.segno}</span>
      {v.testo}
    </span>
  );
}

function Scelta({ valore, onCambia, etichetta, voci }: { valore: string; onCambia: (v: string) => void; etichetta: string; voci: Array<[string, string]> }) {
  return (
    <select aria-label={etichetta} value={valore} onChange={(e) => onCambia(e.target.value)} className={CLASSE_SCELTA}>
      <option value="">{etichetta}</option>
      {voci.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}

function Spunta({ acceso, onCambia, testo }: { acceso: boolean; onCambia: (v: boolean) => void; testo: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <input type="checkbox" checked={acceso} onChange={(e) => onCambia(e.target.checked)} />
      {testo}
    </label>
  );
}

function Paginazione({ pagina, totale, dimensione, onPagina }: { pagina: number; totale: number; dimensione: number; onPagina: (p: number) => void }) {
  const da = totale === 0 ? 0 : pagina * dimensione + 1;
  const a = Math.min(totale, (pagina + 1) * dimensione);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[13px] text-muted-foreground">{da.toLocaleString("it-IT")}–{a.toLocaleString("it-IT")} di {totale.toLocaleString("it-IT")}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => onPagina(pagina - 1)}>Precedenti</Button>
        <Button variant="outline" size="sm" disabled={a >= totale} onClick={() => onPagina(pagina + 1)}>Successivi</Button>
      </div>
    </div>
  );
}

function Dettaglio({ chiave, onChiudi }: { chiave: string | null; onChiudi: () => void }) {
  const [dati, setDati] = useState<{ oggetto: OggettoMappa; spostamenti: VoceSpostamento[] } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const nextSignal = useLatestRequest();
  useEffect(() => {
    if (!chiave) return;
    const signal = nextSignal();
    void (async () => {
      setDati(null);
      setErrore(null);
      try {
        const r = await fetchJson<{ oggetto: OggettoMappa; spostamenti: VoceSpostamento[] }>(`/api/port-map?dettaglio=${encodeURIComponent(chiave)}`, { signal });
        if (signal.aborted) return;
        if (r.ok) setDati(r.data);
        else setErrore(r.message);
      } catch {
        /* richiesta superata */
      }
    })();
  }, [chiave, nextSignal]);
  const o = dati?.oggetto;
  return (
    <Sheet open={chiave != null} onOpenChange={(v) => { if (!v) onChiudi(); }}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetTitle className="sr-only">Dettaglio della posizione</SheetTitle>
        {errore && <LoadError what="il dettaglio" message={errore} />}
        {!errore && !o && <div className="p-4"><SkeletonTable rows={4} columns={2} /></div>}
        {o && (
          <div className="space-y-3 p-4">
            <SchedaDettaglio
              etichetta={o.categoria === "apparato" ? "Apparato" : "Oggetto"}
              titolo={o.nome ?? o.mac ?? o.chiave}
              vuoto=""
              azioni={
                <div className="flex flex-wrap gap-2">
                  {o.hostId != null && <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/hosts/${o.hostId}`} />}>Scheda host</Button>}
                  {o.apparatoId != null && <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/devices/${o.apparatoId}`} />}>Scheda apparato</Button>}
                  {o.deviceId != null && <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/devices/${o.deviceId}`} />}>{o.apparato}</Button>}
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/topology" />}>Topologia</Button>
                </div>
              }
            >
              <DatoDettaglio nome="Perché" valore={o.perche} />
              <DatoDettaglio nome="Confidenza" valore={<SegnoConfidenza c={o.confidenza} />} />
              <DatoDettaglio nome="Dove" valore={o.apparato ? `${o.apparato} · ${o.porta}` : o.ramo} mono />
              <DatoDettaglio nome={o.macs.length > 1 ? `MAC (${o.macs.length})` : "MAC"} valore={o.macs.length > 0 ? o.macs.join(" · ") : o.mac} mono />
              <DatoDettaglio nome={o.ips.length > 1 ? `IP (${o.ips.length})` : "IP"} valore={o.ips.length > 0 ? o.ips.join(" · ") : o.ip} mono />
              <DatoDettaglio nome="Fonti" valore={o.fonti.join(" · ") || null} />
              {o.dedotta && <DatoDettaglio nome="Nota" valore="Posizione dedotta dall'hypervisor, nessuna tabella l'ha vista" />}
            </SchedaDettaglio>
            <Pannello titolo="Prove" conteggio={o.prove.length} sottotitolo="Ogni porta dove è stato visto" corpoClassName="p-0">
              {o.prove.length === 0 ? <p className="p-3 text-[13px] text-muted-foreground">Nessuna riga nelle tabelle degli apparati.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Apparato · porta</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">MAC</TableHead><TableHead>Fonte</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {o.prove.map((p) => (
                      <TableRow key={`${p.apparato}|${p.porta}`} title={p.visto ? `Visto ${quando(p.visto)}` : undefined}>
                        <TableCell className="font-mono text-[13px] whitespace-normal">{p.apparato} · {p.porta}</TableCell>
                        <TableCell className="text-[13px]">{p.tipo === "vista" ? "Solo vista" : TIPI_PORTA[p.tipo]}</TableCell>
                        <TableCell className="text-right font-mono text-[13px]">{p.nMac}</TableCell>
                        <TableCell className="text-[13px]">{p.fonte}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Pannello>
            {dati.spostamenti.length > 0 && (
              <Pannello titolo="Spostamenti" conteggio={dati.spostamenti.length} sottotitolo="Ultimi 90 giorni">
                <ul className="space-y-1.5 font-mono text-[13px]">
                  {dati.spostamenti.map((s) => <li key={`${s.il}|${s.aPorta}`}>{quando(s.il)}: {s.daApparato} · {s.daPorta} → {s.aApparato} · {s.aPorta}</li>)}
                </ul>
              </Pannello>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function MappaPorteClient() {
  const [scheda, setScheda] = useState<Scheda>("oggetti");
  const [testo, setTesto] = useState("");
  const [q, setQ] = useState("");
  const [apparato, setApparato] = useState("");
  const [vlan, setVlan] = useState("");
  const [confidenza, setConfidenza] = useState("");
  const [tipoPorta, setTipoPorta] = useState("");
  const [modo, setModo] = useState("");
  const [senzaHost, setSenzaHost] = useState(false);
  const [spostati, setSpostati] = useState(false);
  const [recenti, setRecenti] = useState(false);
  const [libere, setLibere] = useState(false);
  const [pagina, setPagina] = useState(0);
  // Ordinamento dal server, per scheda (Riccardo, 08/11): nessuna colonna = l'ordine di sempre.
  const [ordinaPer, setOrdinaPer] = useState<string | null>(null);
  const [verso, setVerso] = useState<SortDirection>("asc");
  const [oggetti, setOggetti] = useState<Risposta<OggettoMappa> | null>(null);
  const [porte, setPorte] = useState<Risposta<PortaMappa> | null>(null);
  const [rotte, setRotte] = useState<Risposta<VoceRotta> | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scelto, setScelto] = useState<string | null>(null);
  const nextSignal = useLatestRequest();

  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "porte") setScheda("porte");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(testo.trim()); setPagina(0); }, 300);
    return () => clearTimeout(t);
  }, [testo]);

  const carica = useCallback(async () => {
    const signal = nextSignal();
    const u = new URLSearchParams({ vista: scheda, pagina: String(pagina) });
    const metti = (k: string, v: string | boolean) => { if (v === true) u.set(k, "1"); else if (v) u.set(k, v); };
    metti("q", q); metti("apparato", apparato); metti("tipoPorta", tipoPorta);
    if (ordinaPer) { u.set("sortBy", ordinaPer); u.set("sortDir", verso); }
    if (scheda === "oggetti") { metti("vlan", vlan); metti("confidenza", confidenza); metti("senzaHost", senzaHost); metti("spostati", spostati); metti("recenti", recenti); }
    else if (scheda === "porte") { metti("modo", modo); metti("libere", libere); }
    try {
      const r = await fetchJson<Risposta<OggettoMappa & PortaMappa & VoceRotta>>(`/api/port-map?${u}`, { signal });
      if (signal.aborted) return;
      if (!r.ok) { setErrore(r.message); return; }
      setErrore(null);
      if (scheda === "oggetti") setOggetti(r.data);
      else if (scheda === "porte") setPorte(r.data);
      else setRotte(r.data);
    } catch {
      /* richiesta superata */
    }
  }, [nextSignal, scheda, pagina, q, apparato, tipoPorta, vlan, confidenza, senzaHost, spostati, recenti, modo, libere, ordinaPer, verso]);
  useEffect(() => {
    void carica();
  }, [carica]);

  const conFiltro = <T,>(f: (v: T) => void) => (v: T) => { f(v); setPagina(0); };
  const ordine: OrdinamentoTabella = {
    colonna: ordinaPer, verso,
    onOrdina: (c) => { if (c === ordinaPer) setVerso((v) => (v === "asc" ? "desc" : "asc")); else { setOrdinaPer(c); setVerso("asc"); } setPagina(0); },
  };
  const cambiaScheda = (s: Scheda) => {
    setScheda(s);
    setPagina(0);
    setOrdinaPer(null);
    setVerso("asc");
    setTipoPorta("");
    window.history.replaceState(null, "", `#${s}`);
  };

  const dati = scheda === "oggetti" ? oggetti : scheda === "porte" ? porte : rotte;
  const calcolo = dati?.calcolo ?? oggetti?.calcolo ?? porte?.calcolo ?? rotte?.calcolo ?? null;
  const c = calcolo?.conteggi;
  const apparati = (dati?.apparati ?? []).map((a): [string, string] => [String(a.id), a.nome]);

  return (
    <div className="space-y-4">
      <IntestazionePagina titolo="Mappa porte" sottotitolo="Cosa c'è sulla rete e su quale porta sta." />
      <BarraStato
        acceso={calcolo != null}
        titolo="Calcolo"
        dettagli={calcolo ? [`ultimo ${quando(calcolo.il)}`, `${c?.apparatiConTabella ?? 0} apparati con tabella`, `${c?.apparatiSoloController ?? 0} solo dal controller`, `${c?.senzaHost ?? 0} senza host noto`] : []}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Certe" valore={c?.certe ?? null} nota="Controller, o unico MAC sulla porta" />
        <TesseraNumero titolo="Spiegate" valore={c?.spiegate ?? null} nota="Hypervisor, telefono + PC" />
        <TesseraNumero titolo="Da capire" valore={c?.daCapire ?? null} nota="Più MAC senza motivo" />
        <TesseraNumero titolo="Non so" valore={c?.nonSo ?? null} nota="Solo porte di passaggio" icona={<EthernetPort />} />
      </div>
      <SchedePagina<Scheda>
        etichetta="Viste della mappa"
        voci={[
          { valore: "oggetti", titolo: "Oggetti", descrizione: "Ogni cosa vista in rete e dove sta" },
          { valore: "porte", titolo: "Porte", descrizione: "Ogni porta, aggregato e cosa ha sopra" },
          { valore: "rotte", titolo: "Rotte", descrizione: "Le rotte di tutti i router, comprese quelle non più viste" },
        ]}
        scelta={scheda}
        onScegli={cambiaScheda}
      />
      <Pannello
        titolo={scheda === "oggetti" ? "Oggetti" : scheda === "porte" ? "Porte" : "Rotte"}
        conteggio={dati?.totale}
        corpoClassName="p-0"
        azioni={
          <>
            <Input aria-label="Cerca" placeholder={scheda === "oggetti" ? "Nome, IP, MAC, porta" : scheda === "porte" ? "Porta, apparato, vicino" : "Destinazione, gateway, interfaccia"} value={testo} onChange={(e) => setTesto(e.target.value)} className="h-9 w-52" />
            <Scelta etichetta="Tutti gli apparati" valore={apparato} onCambia={conFiltro(setApparato)} voci={apparati} />
            {scheda === "oggetti" && <Scelta etichetta="Tutte le VLAN" valore={vlan} onCambia={conFiltro(setVlan)} voci={(dati?.vlan ?? []).map((v) => [String(v), `VLAN ${v}`])} />}
            {scheda === "oggetti" && <Scelta etichetta="Ogni confidenza" valore={confidenza} onCambia={conFiltro(setConfidenza)} voci={(Object.keys(CONFIDENZE) as Confidenza[]).map((k) => [k, CONFIDENZE[k].testo])} />}
            {scheda !== "rotte" && <Scelta etichetta="Ogni tipo di porta" valore={tipoPorta} onCambia={conFiltro(setTipoPorta)} voci={TIPI_ELENCO} />}
            {scheda === "porte" && <Scelta etichetta="Ogni modo" valore={modo} onCambia={conFiltro(setModo)} voci={Object.entries(MODI)} />}
            {scheda === "oggetti" && <Spunta testo="Senza host" acceso={senzaHost} onCambia={conFiltro(setSenzaHost)} />}
            {scheda === "oggetti" && <Spunta testo="Spostati" acceso={spostati} onCambia={conFiltro(setSpostati)} />}
            {scheda === "oggetti" && <Spunta testo="Solo visti di recente" acceso={recenti} onCambia={conFiltro(setRecenti)} />}
            {scheda === "porte" && <Spunta testo="Libere" acceso={libere} onCambia={conFiltro(setLibere)} />}
          </>
        }
        piede={
          scheda === "oggetti"
            ? <div className="flex flex-wrap gap-3">{(Object.keys(CONFIDENZE) as Confidenza[]).map((k) => <span key={k} className="flex items-center gap-1.5"><SegnoConfidenza c={k} />{CONFIDENZE[k].spiega}</span>)}</div>
            : <span>≈ dato dedotto: lo switch non dichiara le VLAN in modo completo. «Non letto»: l&apos;apparato non dà quel dato.</span>
        }
      >
        {errore ? <LoadError what="la mappa" message={errore} onRetry={() => void carica()} />
          : !dati ? <div className="p-3"><SkeletonTable rows={8} columns={7} /></div>
          : dati.righe.length === 0 ? <Vuoto titolo="Nessuna riga" testo="Nessun risultato con questi filtri. Dopo un'installazione nuova serve un giro sugli switch." />
          : (
            <div className="space-y-2 p-3">
              {scheda === "oggetti" ? <TabellaOggetti righe={oggetti?.righe ?? []} onScegli={setScelto} ordine={ordine} /> : scheda === "porte" ? <TabellaPorte righe={porte?.righe ?? []} ordine={ordine} /> : <TabellaRotte righe={rotte?.righe ?? []} ordine={ordine} />}
              <Paginazione pagina={pagina} totale={dati.totale} dimensione={dati.dimensionePagina} onPagina={setPagina} />
            </div>
          )}
      </Pannello>
      <Dettaglio chiave={scelto} onChiudi={() => setScelto(null)} />
    </div>
  );
}

function TabellaOggetti({ righe, onScegli, ordine }: { righe: OggettoMappa[]; onScegli: (k: string) => void; ordine: OrdinamentoTabella }) {
  return (
    <Table fissa riserva={70}>
      <TableHeader>
        <TableRow>
          <Testata id="nome" ordine={ordine}>Oggetto</Testata><Testata id="mac" ordine={ordine}>MAC</Testata><Testata id="ip" ordine={ordine}>IP</Testata>
          <Testata id="dove" ordine={ordine}>Dove</Testata><Testata id="vlan" ordine={ordine}>VLAN</Testata><Testata id="confidenza" ordine={ordine}>Confidenza</Testata>
          <Testata id="visto" ordine={ordine} className="hidden min-[1500px]:table-cell">Visto</Testata>
        </TableRow>
      </TableHeader>
      <TableBody>
        {righe.map((o) => (
          <TableRow key={o.chiave} className="cursor-pointer" onClick={() => onScegli(o.chiave)}>
            <TableCell className="max-w-44 truncate font-medium" title={o.nome ?? undefined}>
              {o.nome ?? <span className="font-normal text-muted-foreground">Sconosciuto</span>}
              {(o.tipo || o.vecchio) && <span className="block text-[13px] font-normal text-muted-foreground">{[o.tipo, o.vecchio ? "◌ non più visto" : null].filter(Boolean).join(" · ")}</span>}
            </TableCell>
            <TableCell className="font-mono text-[13px]">{o.mac ?? "—"}{o.macs.length > 1 ? ` +${o.macs.length - 1}` : ""}</TableCell>
            <TableCell className="font-mono text-[13px]">{o.ip ?? "—"}{o.nIp > 1 ? ` +${o.nIp - 1}` : ""}</TableCell>
            <TableCell className="max-w-64 truncate font-mono text-[13px]" title={o.apparato ? `${o.apparato} · ${o.porta}` : o.ramo ?? undefined}>
              {o.apparato ? `${o.apparato} · ${o.porta}` : <span className="text-muted-foreground">{o.ramo}</span>}
              {o.dedotta && o.apparato ? " ≈" : ""}
              {o.conflitto ? " ▲" : ""}
            </TableCell>
            <TableCell className="font-mono text-[13px]">{o.vlan ?? "—"}</TableCell>
            <TableCell><SegnoConfidenza c={o.confidenza} /></TableCell>
            <TableCell className="hidden font-mono text-[13px] whitespace-nowrap min-[1500px]:table-cell">{quando(o.visto)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TabellaRotte({ righe, ordine }: { righe: VoceRotta[]; ordine: OrdinamentoTabella }) {
  return (
    <Table fissa riserva={70}>
      <TableHeader>
        <TableRow>
          <Testata id="apparato" ordine={ordine}>Apparato</Testata><Testata id="destinazione" ordine={ordine}>Destinazione</Testata><Testata id="gateway" ordine={ordine}>Gateway</Testata>
          <Testata id="interfaccia" ordine={ordine}>Interfaccia</Testata><Testata id="protocollo" ordine={ordine}>Protocollo</Testata>
          <Testata id="metrica" ordine={ordine} className="text-right">Metrica</Testata><Testata id="stato" ordine={ordine}>Stato</Testata>
        </TableRow>
      </TableHeader>
      <TableBody>
        {righe.map((r) => (
          <TableRow key={`${r.deviceId}|${r.destinazione}|${r.gateway}|${r.protocollo}`}>
            <TableCell className="max-w-44 truncate"><Link href={`/devices/${r.deviceId}`} className="hover:underline">{r.apparato}</Link></TableCell>
            <TableCell className="font-mono text-[13px]">{r.destinazione}</TableCell>
            <TableCell className="font-mono text-[13px]">{r.gateway || "—"}</TableCell>
            <TableCell className="font-mono text-[13px]">{r.interfaccia ?? "—"}</TableCell>
            <TableCell className="text-[13px]">{r.protocollo || "—"}</TableCell>
            <TableCell className="text-right font-mono text-[13px]">{r.metrica ?? "—"}</TableCell>
            <TableCell className="text-[13px]" title={`Ultima lettura ${quando(r.ultimo)}`}>{!r.presente ? "◌ non più vista" : r.attiva ? "● attiva" : "○ inattiva"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
