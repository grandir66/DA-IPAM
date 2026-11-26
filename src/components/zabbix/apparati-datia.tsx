"use client";

/**
 * «Apparati» di DatIA Mon (Riccardo, 13/11/2026: «gestire in modo accorpato i device, il template o i template
 * associati, e per Windows e Linux la modalità di installazione dell'agent dedicato»).
 *
 * Un elenco solo, raggruppato per famiglia: quelli già in Zabbix e quelli che DA-IPAM conosce e Zabbix no. Si
 * seleziona e si agisce su più apparati insieme. Ogni scrittura passa prima da una prova a vuoto del centro e poi
 * da una conferma; togliere un modello cancella le sue misure e lo si dice. L'agente lo installa sempre una
 * persona: qui si prepara il comando (uno per macchina, o uno solo per tutte che usa il nome della macchina).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Columns3, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarraStato, DatoDettaglio, SchedaDettaglio, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fetchJson } from "@/lib/fetch-json";
import { attesaPrima, durata, eTettoDelGiorno, giorniPer, leggiCoda, registraChiamata, tolto, type Coda } from "@/lib/zabbix-lettura/coda-aggiunta";
import { TESTO_CENTRO_VECCHIO, conProvvisori } from "@/lib/zabbix-lettura/provvisori";
import {
  CAMPI_FILTRO, COLONNE, FILTRI_VUOTI, GRUPPI, NESSUNO, STATI, TESTO_AGENTE, VISTA_AGENTI, VISTA_DI_SERIE, colonna, conColonna, leggiVista, passa, raggruppa,
  nonVisto, spostaColonna, testoRete, valoriFiltro, type Filtri, type Gruppo, type IdColonna, type IdGruppo, type Vista,
} from "@/lib/zabbix-lettura/vista-apparati";
import { piuVecchioDelCentro, type ApparatoElenco, type StatoAgente, type StatoApparato } from "@/lib/zabbix-lettura/apparati";
import type { EsitoAgente, EsitoFamiglia, EsitoModelli, EsitoProponi, EsitoRinomina, EsitoScrittura, EsitoStato, EsitoTogli } from "@/lib/zabbix-lettura/scrittura";

interface Risposta {
  letto: boolean;
  motivo?: string;
  lettoAlle?: string | null;
  vecchio?: boolean;
  famiglie?: Array<{ codice: string; etichetta: string }>;
  versioneCentro?: string | null;
  apparati?: ApparatoElenco[];
  modelliAdatti?: Record<string, string[]> | null;
  scrittura?: { possibile: boolean; motivo?: string };
  proxy?: Array<{ nome: string; inLinea: boolean }>;
}

const TONO: Record<StatoApparato, ToniStato> = { funziona: "ok", attenzione: "attenzione", fermo: "guasto", non_so: "da_verificare", da_aggiungere: "grigio", sospeso: "grigio" };
const TESTO_STATO: Record<StatoApparato, string> = { funziona: "Funziona", attenzione: "Attenzione", fermo: "Fermo", non_so: "Non so", da_aggiungere: "Da aggiungere", sospeso: "Sospeso" };
const AGENTE: Record<StatoAgente, { tono: ToniStato | null; testo: string }> = {
  si: { tono: "ok", testo: "attivo" },
  no: { tono: "attenzione", testo: "non manda dati" },
  non_so: { tono: "da_verificare", testo: "non so" },
  non_serve: { tono: null, testo: "non serve" },
  da_installare: { tono: "grigio", testo: "da installare" },
};

function Badge({ tono, testo }: { tono: ToniStato; testo: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO[tono].classi}`}>
      <span aria-hidden>{STILE_STATO[tono].segno}</span>
      {testo}
    </span>
  );
}

/** «Sospeso» ha un segno suo: due barre, bordo tratteggiato spesso, fondo chiaro. Non si confonde con «Fermo» (pieno). */
function BadgeSospeso() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border-2 border-dashed border-foreground bg-background px-1.5 py-0.5 text-[13px] font-semibold text-foreground">
      <span aria-hidden>‖</span>
      Sospeso
    </span>
  );
}

/** «✎ a mano»: la famiglia l'ha scelta una persona. Riquadro con bordo scuro, si riconosce per forma e non per colore. */
function SegnoAMano() {
  return (
    <span title="Famiglia scelta da una persona: il centro non la cambia da sé" className="ml-1.5 inline-flex items-center whitespace-nowrap rounded border-2 border-foreground bg-[#FFD400] px-1 text-[13px] font-semibold text-[#0D2537]">
      ✎ a mano
    </span>
  );
}

const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** POST con attesa: il centro accetta dieci scritture al minuto, e su «aspetta» si aspetta. */
async function postaConAttesa<T>(url: string, corpo: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const r = await fetchJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (r.ok) return { ok: true, data: r.data };
    if (/troppe richieste|aspetta/i.test(r.message)) {
      await pausa(7000);
      continue;
    }
    return { ok: false, message: r.message };
  }
  return { ok: false, message: "Il centro chiede di aspettare: riprova fra un minuto" };
}

function BloccoComando({ titolo, comando, file }: { titolo: string; comando: string; file: string }) {
  const [copiato, setCopiato] = useState(false);
  async function copia() {
    try {
      await navigator.clipboard.writeText(comando);
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    } catch {
      toast.error("Copia non riuscita: selezionalo a mano");
    }
  }
  function scarica() {
    const url = URL.createObjectURL(new Blob([comando + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{titolo}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void copia()}>
          {copiato ? <Check className="mr-1 size-4" /> : <Copy className="mr-1 size-4" />}
          {copiato ? "Copiato" : "Copia"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={scarica}>
          <Download className="mr-1 size-4" />
          Scarica
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-[12px]">{comando}</pre>
    </div>
  );
}

// ── Finestra dei modelli: aggiungere o togliere, su uno o più apparati ──

type CambioModelli = { tipo: "aggiungi" | "togli"; apparati: ApparatoElenco[]; /** Il modello già scelto (dal «Togli» della scheda). */ modello?: string };

function FinestraModelli({ cambio, adatti, chiudi, fatto }: { cambio: CambioModelli; adatti: Record<string, string[]> | null; chiudi: () => void; fatto: () => void }) {
  const [modello, setModello] = useState<string>(cambio.modello ?? "");
  const [prove, setProve] = useState<Map<string, { ok: true; esito: EsitoModelli } | { ok: false; errore: string }> | null>(null);
  const [lavoro, setLavoro] = useState<"prova" | "applica" | null>(null);
  const [esiti, setEsiti] = useState<Map<string, string> | null>(null);

  const scelte = useMemo(() => {
    const insieme = new Set<string>();
    for (const a of cambio.apparati) {
      if (cambio.tipo === "aggiungi") for (const m of adatti?.[a.famiglia] ?? []) insieme.add(m);
      else for (const m of a.modelli) insieme.add(m);
    }
    return [...insieme].sort((x, y) => x.localeCompare(y, "it"));
  }, [cambio, adatti]);

  async function prova() {
    setLavoro("prova");
    const m = new Map<string, { ok: true; esito: EsitoModelli } | { ok: false; errore: string }>();
    for (const a of cambio.apparati) {
      const r = await postaConAttesa<EsitoModelli>("/api/zabbix/apparati/modelli", { hostid: a.hostid, [cambio.tipo]: [modello], prova: true });
      m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
      setProve(new Map(m));
    }
    setLavoro(null);
  }

  async function applica() {
    setLavoro("applica");
    const m = new Map<string, string>();
    for (const a of cambio.apparati) {
      const p = prove?.get(a.chiave);
      if (!p?.ok || (p.esito.aggiunti.length === 0 && p.esito.tolti.length === 0)) continue;
      const r = await postaConAttesa<EsitoModelli>("/api/zabbix/apparati/modelli", { hostid: a.hostid, [cambio.tipo]: [modello] });
      m.set(a.chiave, r.ok ? "fatto" : r.message);
      setEsiti(new Map(m));
    }
    setLavoro(null);
    fatto();
  }

  const daCambiare = prove ? [...prove.values()].filter((p) => p.ok && (p.esito.aggiunti.length || p.esito.tolti.length)).length : 0;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && lavoro === null) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">{cambio.tipo === "aggiungi" ? "Aggiungi un modello" : "Togli un modello"} · {cambio.apparati.length} apparati</DialogTitle>
          <DialogDescription>
            {cambio.tipo === "aggiungi"
              ? "Solo i modelli adatti alla famiglia degli apparati scelti."
              : "Togliere un modello cancella in Zabbix le sue misure su questi apparati. Un apparato resta sempre con almeno un modello."}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="space-y-3 px-4 py-3">
          {scelte.length === 0 ? (
            <p className="text-sm">{adatti ? "Nessun modello da scegliere per questi apparati." : "L'elenco dei modelli adatti non si è letto dal centro."}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {scelte.map((m) => (
                <Button key={m} type="button" size="sm" variant={modello === m ? "default" : "outline"} disabled={lavoro !== null || esiti !== null} onClick={() => { setModello(m); setProve(null); }}>
                  {m}
                </Button>
              ))}
            </div>
          )}
          {prove && (
            <ul className="divide-y text-sm">
              {cambio.apparati.map((a) => {
                const p = prove.get(a.chiave);
                const e = esiti?.get(a.chiave);
                const testo = !p ? "…" : !p.ok ? p.errore : p.esito.aggiunti.length || p.esito.tolti.length ? (cambio.tipo === "aggiungi" ? "verrà aggiunto" : "verrà tolto, con le sue misure") : cambio.tipo === "aggiungi" ? "ce l'ha già" : "non ce l'ha";
                return (
                  <li key={a.chiave} className="flex gap-3 py-1.5">
                    <span className="w-56 min-w-0 truncate font-medium">{a.nome}</span>
                    <span className="flex-1 text-muted-foreground">{e ? (e === "fatto" ? "fatto" : e) : testo}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {!prove && (
            <Button type="button" disabled={!modello || lavoro !== null} onClick={() => void prova()}>
              {lavoro === "prova" && <Loader2 className="mr-1 size-4 animate-spin" />}Prova
            </Button>
          )}
          {prove && !esiti && (
            <Button type="button" disabled={!daCambiare || lavoro !== null} onClick={() => void applica()}>
              {lavoro === "applica" && <Loader2 className="mr-1 size-4 animate-spin" />}
              {cambio.tipo === "aggiungi" ? `Aggiungi a ${daCambiare}` : `Togli da ${daCambiare}`}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={lavoro !== null} onClick={chiudi}>{esiti ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Finestra della famiglia (13/11/2026): il tag `famiglia` in Zabbix, dove l'apparato compare per il cliente ──

/** Le famiglie che sono righe ricavate dal centro (dominio, database, datastore): non si danno a un apparato. */
const FAMIGLIE_RICAVATE = new Set(["dominio", "db", "datastore"]);

function FinestraFamiglia({ apparati, famiglie, automatico = false, chiudi, fatto, segnala }: {
  apparati: ApparatoElenco[];
  famiglie: Array<{ codice: string; etichetta: string }>;
  /** «Torna all'automatico» (26/11/2026): niente scelta, la famiglia la decide di nuovo il centro; prima la prova a vuoto. */
  automatico?: boolean;
  chiudi: () => void;
  fatto: () => void;
  segnala: (messaggio: string) => void;
}) {
  const [scelta, setScelta] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const [esiti, setEsiti] = useState<Map<string, string> | null>(null);
  const [prove, setProve] = useState<Map<string, { tipo: "errore" | "uguale" | "torna"; testo: string }>>(new Map());
  const voci = famiglie.filter((f) => !FAMIGLIE_RICAVATE.has(f.codice));
  const etichetta = (codice: string) => famiglie.find((f) => f.codice === codice)?.etichetta ?? codice;

  useEffect(() => {
    if (!automatico) return;
    let fermo = false;
    void (async () => {
      const m = new Map<string, { tipo: "errore" | "uguale" | "torna"; testo: string }>();
      for (const a of apparati) {
        await passo();
        if (fermo) return;
        const r = await postaConAttesa<EsitoFamiglia>("/api/zabbix/apparati/famiglia", { hostid: a.hostid, famiglia: null, prova: true });
        if (fermo) return;
        if (!r.ok) segnala(r.message);
        m.set(a.chiave, r.ok ? (r.data.esito === "invariato" ? { tipo: "uguale", testo: "è già automatica" } : { tipo: "torna", testo: r.data.famiglia ?? r.data.dopo }) : { tipo: "errore", testo: r.message });
        setProve(new Map(m));
      }
    })();
    return () => { fermo = true; };
  }, [automatico, apparati, segnala]);

  async function applica() {
    if (!automatico && scelta === null) return;
    setLavoro(true);
    const m = new Map<string, string>();
    for (const a of apparati) {
      const r = await postaConAttesa<{ esito: string }>("/api/zabbix/apparati/famiglia", { hostid: a.hostid, famiglia: automatico ? null : scelta });
      m.set(a.chiave, r.ok ? (r.data.esito === "invariato" ? "era già così" : "fatto") : r.message);
      setEsiti(new Map(m));
    }
    setLavoro(false);
    fatto();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !lavoro) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">{automatico ? "Torna all'automatico" : "Cambia famiglia"} · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            {automatico
              ? "Toglie la scelta fatta a mano: la famiglia torna a deciderla il centro. Si scrive in Zabbix e non tocca né modelli né misure."
              : "La famiglia decide dove l'apparato compare nella pagina del cliente. Si scrive in Zabbix e non tocca né modelli né misure."}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="space-y-3 px-4 py-3">
          {!automatico && <div className="flex flex-wrap gap-1.5">
            {voci.map((f) => (
              <Button key={f.codice} type="button" size="sm" variant={scelta === f.codice ? "default" : "outline"} disabled={lavoro || esiti !== null} onClick={() => setScelta(f.codice)}>
                {f.etichetta}
              </Button>
            ))}
            <Button type="button" size="sm" variant={scelta === "" ? "default" : "outline"} disabled={lavoro || esiti !== null} onClick={() => setScelta("")}>
              Come la decide il centro
            </Button>
          </div>}
          <ul className="divide-y text-sm">
            {apparati.map((a) => (
              <li key={a.chiave} className="flex gap-3 py-1.5">
                <span className="w-56 min-w-0 truncate font-medium">{a.nome}</span>
                <span className="flex-1 text-muted-foreground">
                  {esiti?.get(a.chiave) ?? (automatico
                    ? (() => {
                        const p = prove.get(a.chiave);
                        return p ? (p.tipo === "torna" ? `ora: ${etichetta(a.famiglia)} (a mano) → tornerà: ${p.testo ? etichetta(p.testo) : "quella decisa dal centro"}` : p.tipo === "errore" ? `✕ ${p.testo}` : p.testo) : "…";
                      })()
                    : `ora: ${etichetta(a.famiglia)}`)}
                </span>
              </li>
            ))}
          </ul>
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {!esiti && (
            <Button type="button" disabled={(!automatico && scelta === null) || lavoro || (automatico && apparati.some((a) => !prove.has(a.chiave)))} onClick={() => void applica()}>
              {lavoro && <Loader2 className="mr-1 size-4 animate-spin" />}{automatico ? "Torna all'automatico" : "Cambia"}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={lavoro} onClick={chiudi}>{esiti ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Finestra dell'agente: una macchina alla volta, o un comando per tutte ──

type ModoAgente = "una_per_una" | "windows_tutte" | "linux_tutte";

function FinestraAgente({ apparati, chiudi }: { apparati: ApparatoElenco[]; chiudi: () => void }) {
  const conAgente = apparati.filter((a) => a.sistema && a.hostid);
  const senza = apparati.filter((a) => !a.sistema || !a.hostid);
  const windows = conAgente.filter((a) => a.sistema === "windows");
  const linux = conAgente.filter((a) => a.sistema === "linux");
  const [modo, setModo] = useState<ModoAgente>("una_per_una");
  const [comandi, setComandi] = useState<Array<{ titolo: string; comando: string; file: string }> | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  // Se il centro non sa dove l'agente deve mandare i dati (cliente senza proxy), lo si scrive qui una volta.
  const [indirizzo, setIndirizzo] = useState("");
  const [chiediIndirizzo, setChiediIndirizzo] = useState(false);

  async function prepara() {
    setLavoro(true);
    setErrore(null);
    const fuori: Array<{ titolo: string; comando: string; file: string }> = [];
    const chiedi = async (sistema: "windows" | "linux", hostname: string | null) => {
      const r = await postaConAttesa<EsitoAgente>("/api/zabbix/apparati/agente", { sistema, hostname, serverActive: indirizzo.trim() || null });
      if (!r.ok && /indirizzo/.test(r.message)) setChiediIndirizzo(true);
      return r;
    };
    if (modo === "una_per_una") {
      for (const a of conAgente) {
        const r = await chiedi(a.sistema!, a.hostTecnico);
        if (!r.ok) { setErrore(r.message); break; }
        fuori.push({ titolo: `${a.nome}${a.hostTecnico && a.hostTecnico !== a.nome ? ` (in Zabbix: ${a.hostTecnico})` : ""}`, comando: r.data.comando, file: `agente-zabbix-${a.hostTecnico ?? a.nome}.${a.sistema === "windows" ? "ps1" : "sh"}` });
        setComandi([...fuori]);
      }
    } else {
      const sistema = modo === "windows_tutte" ? "windows" : "linux";
      const r = await chiedi(sistema, null);
      if (r.ok) fuori.push({ titolo: sistema === "windows" ? "Tutte le Windows (GPO o Intune)" : "Tutti i Linux", comando: r.data.comando, file: `agente-zabbix-tutte.${sistema === "windows" ? "ps1" : "sh"}` });
      else setErrore(r.message);
    }
    setComandi(fuori.length ? fuori : null);
    setLavoro(false);
  }

  const perTutte = modo !== "una_per_una" ? (modo === "windows_tutte" ? windows : linux) : [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !lavoro) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">Prepara l&apos;agente · {windows.length} Windows, {linux.length} Linux</DialogTitle>
          <DialogDescription>L&apos;agente manda i dati al proxy di questo cliente: nessuna porta da aprire. L&apos;installazione la fa sempre una persona.</DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="space-y-3 px-4 py-3">
          <fieldset className="space-y-1.5 text-sm" disabled={lavoro || comandi !== null}>
            <label className="flex items-start gap-2">
              <input type="radio" name="modo" checked={modo === "una_per_una"} onChange={() => setModo("una_per_una")} className="mt-1" />
              <span><b>Una macchina alla volta</b> — un comando per ognuna, da incollare o scaricare (.ps1, .sh).</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="modo" checked={modo === "windows_tutte"} onChange={() => setModo("windows_tutte")} disabled={!windows.length} className="mt-1" />
              <span><b>Tutte le Windows del dominio</b> — un comando solo, da distribuire con GPO o Intune: ogni macchina si presenta col suo nome.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="modo" checked={modo === "linux_tutte"} onChange={() => setModo("linux_tutte")} disabled={!linux.length} className="mt-1" />
              <span><b>Tutti i Linux</b> — un comando solo, uguale per tutti: ogni macchina si presenta col suo nome.</span>
            </label>
          </fieldset>
          {perTutte.length > 0 && !comandi && (
            <div className="rounded-md border p-2 text-[13px]">
              <p className="font-semibold">Il comando unico funziona dove il nome in Zabbix è il nome della macchina. Controlla questi:</p>
              <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">{perTutte.map((a) => <li key={a.chiave} className="truncate font-mono">{a.hostTecnico ?? a.nome}</li>)}</ul>
            </div>
          )}
          {senza.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {senza.length} fra quelli scelti non sono Windows o Linux già in Zabbix: per quelli da aggiungere lo script arriva con l&apos;aggiunta.
            </p>
          )}
          {errore && <p className="text-sm text-[#8E1B20] dark:text-[#E8625A]">{errore}</p>}
          {chiediIndirizzo && !comandi && (
            <div className="space-y-1 rounded-md border p-2">
              <label htmlFor="agente-indirizzo" className="text-sm font-semibold">A quale indirizzo l&apos;agente manda i dati</label>
              <p className="text-[13px] text-muted-foreground">
                Il centro non lo sa per questo cliente (nessun proxy). Scrivi l&apos;indirizzo del proxy o del server Zabbix come lo
                raggiungono le macchine del cliente: resta salvato per le prossime volte.
              </p>
              <Input id="agente-indirizzo" className="h-8 max-w-xs font-mono" placeholder="192.168.4.15" value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} />
            </div>
          )}
          {comandi?.map((c) => <BloccoComando key={c.titolo} {...c} />)}
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {!comandi && (
            <Button type="button" disabled={lavoro || !conAgente.length} onClick={() => void prepara()}>
              {lavoro && <Loader2 className="mr-1 size-4 animate-spin" />}Prepara
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={lavoro} onClick={chiudi}>{comandi ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Finestra «Aggiungi a Zabbix»: prova per ognuno, poi conferma; in massa va in coda entro i tetti del centro ──

const CHIAVE_CODA = "zabbix-coda-aggiunta";

function codaSalvata(): Coda {
  try {
    return leggiCoda(window.localStorage.getItem(CHIAVE_CODA), new Date());
  } catch {
    return leggiCoda(null, new Date());
  }
}
function scriviCoda(c: Coda) {
  try {
    window.localStorage.setItem(CHIAVE_CODA, JSON.stringify(c));
  } catch {
    // Senza memoria del browser la coda vale finché la finestra resta aperta: lo dice il testo della finestra.
  }
}
/** Salva la coda; le chiamate recenti le scrive solo `passo()`, quindi una copia vecchia della coda non le cancella. */
function salvaCoda(c: Coda) {
  scriviCoda({ ...c, chiamate: codaSalvata().chiamate });
}

/**
 * Il passo di tutte le scritture al centro, prove comprese: il centro accetta dieci scritture al minuto. Le chiamate
 * recenti stanno nella coda salvata, così il tetto vale anche tra una finestra e l'altra (26/11/2026: «Riprendi la
 * coda» dopo una prova mandava 8 chiamate di fila e il centro rispondeva 502).
 */
async function passo() {
  const attesa = attesaPrima(codaSalvata(), new Date());
  if (attesa > 0) await pausa(attesa);
  scriviCoda(registraChiamata(codaSalvata(), new Date()));
}

type RigaAggiunta = { ok: true; esito: EsitoScrittura } | { ok: false; errore: string };

function FinestraAggiungi({ apparati, giaProvati = false, chiudi, fatto }: {
  apparati: ApparatoElenco[];
  /** Ripresa della coda: il centro li ha già accettati in una prova, si aggiungono senza rifarla. */
  giaProvati?: boolean;
  chiudi: () => void;
  /** Riceve le righe entrate in Zabbix in questa finestra: la pagina le tiene visibili finché la lettura non le contiene. */
  fatto: (aggiunti: ApparatoElenco[]) => void;
}) {
  const [righe, setRighe] = useState<Map<string, RigaAggiunta>>(new Map());
  const [fase, setFase] = useState<"prova" | "pronto" | "aggiungo" | "fermo" | "fatto">(giaProvati ? "pronto" : "prova");
  const [script, setScript] = useState<Array<{ titolo: string; comando: string; file: string }>>([]);
  const [perche, setPerche] = useState<string | null>(null);
  const [oggi, setOggi] = useState(0);
  const [fatti, setFatti] = useState(0);
  const ferma = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => { setOggi(codaSalvata().aggiuntiOggi); }, []);

  useEffect(() => {
    if (giaProvati) return;
    void (async () => {
      const m = new Map<string, RigaAggiunta>();
      for (const a of apparati) {
        await passo();
        if (!vivo.current) return;
        const r = await postaConAttesa<EsitoScrittura>(`/api/hosts/${a.hostIdIpam}/zabbix`, { prova: true });
        if (!vivo.current) return;
        m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
        setRighe(new Map(m));
      }
      setFase("pronto");
    })();
  }, [apparati, giaProvati]);

  const accettati = giaProvati
    ? apparati.filter((a) => !righe.has(a.chiave) || !righe.get(a.chiave)!.ok)
    : apparati.filter((a) => { const r = righe.get(a.chiave); return r?.ok && r.esito.esito === "prova"; });

  async function aggiungi() {
    setFase("aggiungo");
    setPerche(null);
    ferma.current = false;
    const daFare = accettati;
    let coda = codaSalvata();
    coda = { ...coda, chiavi: [...new Set([...coda.chiavi, ...daFare.map((a) => a.chiave)])] };
    salvaCoda(coda);
    const m = new Map(righe);
    const s = [...script];
    let n = 0;
    const entrati: ApparatoElenco[] = [];
    let motivo: string | null = null;
    for (const a of daFare) {
      if (ferma.current) { motivo = "Fermata da te"; break; }
      await passo();
      if (!vivo.current) return;
      const r = await postaConAttesa<EsitoScrittura>(`/api/hosts/${a.hostIdIpam}/zabbix`, {});
      if (!vivo.current) return;
      if (!r.ok && eTettoDelGiorno(r.message)) { motivo = "Il centro ha raggiunto il tetto di oggi (100 apparati al giorno)"; break; }
      m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
      if (r.ok) {
        // Esce dalla coda chi ha avuto una risposta dal centro; un errore di rete lo lascia in coda per la ripresa.
        coda = tolto(coda, a.chiave, r.data.esito === "inserito" || r.data.esito === "serve_agente", new Date());
        salvaCoda(coda);
        setOggi(coda.aggiuntiOggi);
        if (r.data.esito === "inserito" || r.data.esito === "serve_agente") entrati.push(a);
        if (r.data.esito === "serve_agente" && r.data.comando) {
          s.push({ titolo: r.data.host, comando: r.data.comando, file: `agente-zabbix-${r.data.host}.${r.data.sistema === "windows" ? "ps1" : "sh"}` });
        }
      }
      setFatti(++n);
      setRighe(new Map(m));
    }
    setScript(s);
    const restano = daFare.filter((a) => coda.chiavi.includes(a.chiave)).length;
    setPerche(restano ? `${motivo ?? "Alcuni non hanno avuto risposta dal centro"}: ne restano ${restano} in coda. Si riprendono con «Riprendi la coda» nella pagina.` : null);
    setFase(restano ? "fermo" : "fatto");
    fatto(entrati);
  }

  function testo(a: ApparatoElenco): string {
    const r = righe.get(a.chiave);
    if (!r) return giaProvati ? "in coda" : "…";
    if (!r.ok) return r.errore;
    const e = r.esito;
    switch (e.esito) {
      case "prova": return `${e.farebbe === "serve_agente" ? "entra, poi serve l'agente" : "entra"} · ${e.template.filter((t) => t !== "ICMP Ping").join(", ") || "solo ping"}`;
      case "fuori_perimetro": return `fuori perimetro: ${e.motivo}`;
      case "gia_presente": return `c'è già come «${e.host}»`;
      case "inserito": return `aggiunto come «${e.host}»`;
      case "serve_agente": return `aggiunto come «${e.host}», manca l'agente`;
    }
  }

  const giorni = giorniPer(accettati.length, oggi);
  const stato =
    fase === "prova" ? `Prova ${righe.size} di ${apparati.length} · ancora ${durata(apparati.length - righe.size)}`
    : fase === "pronto" ? `Entrano ${accettati.length} · ${durata(accettati.length)}${giorni > 1 ? ` oggi, poi il tetto di 100 al giorno: ${giorni} giorni in tutto` : ""}`
    : fase === "aggiungo" ? `Aggiunta ${fatti} di ${accettati.length + fatti} · la finestra deve restare aperta`
    : perche ?? "Finito";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && fase !== "aggiungo") chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">{giaProvati ? "Riprendi la coda" : "Aggiungi a Zabbix"} · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            {giaProvati ? "Il centro li ha già accettati in una prova: si aggiungono senza rifarla." : "Prima il centro dice cosa farebbe per ognuno; si aggiungono solo quelli che accetta."}
            {" "}Il centro accetta 10 scritture al minuto e 100 apparati al giorno; aggiunti oggi da questo browser: {oggi}.
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="space-y-3 px-4 py-3">
          <ul className="divide-y text-sm">
            {apparati.map((a) => (
              <li key={a.chiave} className="flex gap-3 py-1.5">
                <span className="w-56 min-w-0 truncate font-medium">{a.nome}</span>
                <span className="flex-1 text-muted-foreground">{testo(a)}</span>
              </li>
            ))}
          </ul>
          {script.map((c) => <BloccoComando key={c.titolo} {...c} />)}
        </DialogScrollableArea>
        <DialogFooter className="items-center border-t px-4 py-3">
          <span className="mr-auto text-[13px]" aria-live="polite">{stato}</span>
          {(fase === "prova" || fase === "pronto" || fase === "fermo") && (
            <Button type="button" disabled={fase === "prova" || !accettati.length} onClick={() => void aggiungi()}>
              {fase === "prova" && <Loader2 className="mr-1 size-4 animate-spin" />}{fase === "fermo" ? `Riprova i ${accettati.length} rimasti` : `Aggiungi ${accettati.length}`}
            </Button>
          )}
          {fase === "aggiungo" && <Button type="button" variant="outline" onClick={() => { ferma.current = true; }}>Ferma dopo questo</Button>}
          <Button type="button" variant="ghost" disabled={fase === "aggiungo"} onClick={chiudi}>{fase === "fatto" || fase === "fermo" ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── «Proponi i modelli» (26/11/2026): il centro rifà la sua scelta con quello che DA-IPAM sa oggi ──

type RigaProposta = { ok: true; esito: EsitoProponi } | { ok: false; errore: string };

/**
 * Per ogni apparato: «Ora in Zabbix» e TUTTI i modelli che il centro trova utili, uno per riga, ognuno con la sua
 * casella e il suo «Perché» (Riccardo, 26/11: «i modelli devi trovare tutti quelli che possono essere utili»).
 * Spuntati di serie solo quelli consigliati e pronti; un modello non pronto si vede, col perché, e non si spunta.
 * Niente si scrive prima di «Applica».
 */
function FinestraProponi({ apparati, chiudi, fatto, segnala }: { apparati: ApparatoElenco[]; chiudi: () => void; fatto: () => void; segnala: (messaggio: string) => void }) {
  const [righe, setRighe] = useState<Map<string, RigaProposta>>(new Map());
  const [spuntati, setSpuntati] = useState<Set<string>>(new Set());
  const [fase, setFase] = useState<"leggo" | "pronto" | "applico" | "fatto">("leggo");
  const [esiti, setEsiti] = useState<Map<string, string>>(new Map());
  const chiaveMod = (a: ApparatoElenco, modello: string) => `${a.chiave}|${modello}`;

  useEffect(() => {
    let fermo = false;
    void (async () => {
      const m = new Map<string, RigaProposta>();
      for (const a of apparati) {
        await passo();
        if (fermo) return;
        const r = await postaConAttesa<EsitoProponi>("/api/zabbix/apparati/proponi", { hostid: a.hostid, ipamId: a.schedaIpam, ip: a.ip });
        if (fermo) return;
        if (!r.ok) segnala(r.message);
        m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
        if (r.ok) {
          setSpuntati((p) => {
            const n = new Set(p);
            for (const x of r.data.proposti) if (x.consigliato && x.pronto) n.add(`${a.chiave}|${x.modello}`);
            return n;
          });
        }
        setRighe(new Map(m));
      }
      setFase("pronto");
    })();
    return () => { fermo = true; };
  }, [apparati, segnala]);

  /** I modelli da aggiungere per un apparato: spuntati e pronti, mai gli altri. */
  const daAggiungere = (a: ApparatoElenco): string[] => {
    const r = righe.get(a.chiave);
    return r?.ok ? r.esito.proposti.filter((x) => x.pronto && spuntati.has(chiaveMod(a, x.modello))).map((x) => x.modello) : [];
  };
  const totale = apparati.reduce((n, a) => n + daAggiungere(a).length, 0);

  async function applica() {
    setFase("applico");
    const m = new Map<string, string>();
    for (const a of apparati) {
      const modelli = daAggiungere(a);
      const dettagli: string[] = [];
      // La rotta dei modelli ne accetta dieci per volta.
      for (let i = 0; i < modelli.length; i += 10) {
        await passo();
        const blocco = modelli.slice(i, i + 10);
        // Chi prende il posto di un altro modello (il ping) lo toglie nella stessa scrittura: insieme Zabbix li rifiuta.
        const riga = righe.get(a.chiave);
        const via = riga?.ok ? [...new Set(riga.esito.proposti.filter((x) => blocco.includes(x.modello)).flatMap((x) => x.sostituisce))].filter((m) => !blocco.includes(m)) : [];
        const r = await postaConAttesa<EsitoModelli>("/api/zabbix/apparati/modelli", { hostid: a.hostid, aggiungi: blocco, ...(via.length ? { togli: via } : {}) });
        dettagli.push(r.ok ? (r.data.esito === "invariato" ? "c'erano già" : `aggiunti: ${r.data.aggiunti.join(", ")}${r.data.tolti?.length ? ` · tolti: ${r.data.tolti.join(", ")}` : ""}`) : `✕ ${r.message}`);
      }
      if (modelli.length) m.set(a.chiave, dettagli.join(" · "));
      setEsiti(new Map(m));
    }
    setFase("fatto");
    fatto();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && fase !== "applico") chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">Proponi i modelli · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            Il centro rifà la sua scelta con quello che DA-IPAM sa oggi (famiglia, marca, credenziali valide). Niente si scrive finché non premi «Applica».
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Apparato</th>
                <th className="px-2 py-1.5 font-semibold">Ora in Zabbix</th>
                <th className="px-2 py-1.5 font-semibold">Proposta del centro</th>
                <th className="px-2 py-1.5 font-semibold">Perché</th>
              </tr>
            </thead>
            <tbody>
              {apparati.map((a) => {
                const r = righe.get(a.chiave);
                const proposti = r?.ok ? r.esito.proposti : [];
                return (
                  <Fragment key={a.chiave}>
                    <tr className="border-t">
                      <td className="px-2 py-1.5 font-semibold">{a.nome}</td>
                      <td className="px-2 py-1.5">{r?.ok && r.esito.ora.length ? r.esito.ora.join(", ") : a.modelli.join(", ") || "—"}</td>
                      <td className="px-2 py-1.5" colSpan={2}>
                        {!r ? "…" : !r.ok ? <span className="font-semibold">✕ {r.errore}</span> : proposti.length === 0 ? <span className="text-muted-foreground">= resta com&apos;è</span> : null}
                        {esiti.get(a.chiave) && <span className="ml-2 font-semibold">{esiti.get(a.chiave)}</span>}
                      </td>
                    </tr>
                    {proposti.map((x) => {
                      const k = chiaveMod(a, x.modello);
                      return (
                        <tr key={k}>
                          <td />
                          <td />
                          <td className="px-2 py-1">
                            <label className="flex items-center gap-2">
                              <input type="checkbox" checked={x.pronto && spuntati.has(k)} disabled={!x.pronto || fase === "applico" || fase === "fatto"} onChange={(e) => setSpuntati((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                              <span className={x.pronto ? "font-semibold" : "text-muted-foreground"}>{x.pronto ? "→ " : ""}{x.modello}</span>
                            </label>
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{x.pronto ? "" : "▲ non pronto: "}{x.perche}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[13px]">▲ Un modello non pronto si vede ma non si applica: la riga dice cosa manca (per esempio una credenziale SNMP valida).</p>
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {fase === "leggo" && <span className="mr-auto text-[13px]" aria-live="polite">Leggo {righe.size} di {apparati.length}</span>}
          {fase !== "fatto" && (
            <Button type="button" disabled={fase !== "pronto" || totale === 0} onClick={() => void applica()}>
              {fase === "applico" && <Loader2 className="mr-1 size-4 animate-spin" />}Applica {totale}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={fase === "applico"} onClick={chiudi}>{fase === "fatto" ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── «Rinomina» (26/11/2026): cambia il nome mostrato in Zabbix, non quello che l'agente dichiara ──

type ProvaNome = { nome: string; r: { ok: true; esito: EsitoRinomina } | { ok: false; errore: string } };

/** La prova a vuoto del nuovo nome, riga per riga, nel passo del centro. */
async function provaRighe(apparati: ApparatoElenco[], nomi: Map<string, string>, aggiorna: (m: Map<string, ProvaNome>) => void, fermo: () => boolean, segnala: (messaggio: string) => void) {
  const m = new Map<string, ProvaNome>();
  for (const a of apparati) {
    const nome = (nomi.get(a.chiave) ?? "").trim();
    if (!nome) {
      m.set(a.chiave, { nome, r: { ok: false, errore: "il nome non può essere vuoto" } });
      aggiorna(new Map(m));
      continue;
    }
    await passo();
    if (fermo()) return;
    const r = await postaConAttesa<EsitoRinomina>("/api/zabbix/apparati/rinomina", { hostid: a.hostid, nome, prova: true });
    if (fermo()) return;
    if (!r.ok) segnala(r.message);
    m.set(a.chiave, { nome, r: r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message } });
    aggiorna(new Map(m));
  }
}

function FinestraRinomina({ apparati, chiudi, fatto, segnala }: { apparati: ApparatoElenco[]; chiudi: () => void; fatto: () => void; segnala: (messaggio: string) => void }) {
  // Proposto: il nome di DA-IPAM. Chi apre la finestra l'ha scelta perché i due nomi sono diversi.
  const [nuovi, setNuovi] = useState<Map<string, string>>(() => new Map(apparati.map((a) => [a.chiave, a.nomeIpam ?? a.nome])));
  const [prove, setProve] = useState<Map<string, ProvaNome>>(new Map());
  const [lavoro, setLavoro] = useState<"prova" | "applica" | null>("prova");
  const [esiti, setEsiti] = useState<Map<string, string> | null>(null);
  const attivo = useRef(true);

  useEffect(() => {
    let fermo = false;
    attivo.current = true;
    void provaRighe(apparati, new Map(apparati.map((a) => [a.chiave, a.nomeIpam ?? a.nome])), setProve, () => fermo, segnala).then(() => { if (!fermo) setLavoro(null); });
    return () => { fermo = true; attivo.current = false; };
  }, [apparati, segnala]);

  async function riprova() {
    setLavoro("prova");
    setProve(new Map());
    await provaRighe(apparati, nuovi, setProve, () => !attivo.current, segnala);
    if (attivo.current) setLavoro(null);
  }

  /** Una riga si scrive solo se la sua prova è passata, ed è sul nome che c'è ora nel campo. */
  const passata = (a: ApparatoElenco): string | null => {
    const p = prove.get(a.chiave);
    return p && p.r.ok && p.r.esito.esito === "prova" && p.nome === (nuovi.get(a.chiave) ?? "").trim() ? p.nome : null;
  };
  const daScrivere = apparati.filter((a) => passata(a) !== null);

  async function applica() {
    setLavoro("applica");
    const m = new Map<string, string>();
    for (const a of daScrivere) {
      await passo();
      const r = await postaConAttesa<EsitoRinomina>("/api/zabbix/apparati/rinomina", { hostid: a.hostid, nome: passata(a), prova: false });
      m.set(a.chiave, r.ok ? (r.data.esito === "uguale" ? "era già così" : "fatto") : `✕ ${r.message}`);
      setEsiti(new Map(m));
    }
    setLavoro(null);
    fatto();
  }

  function esito(a: ApparatoElenco): string {
    const e = esiti?.get(a.chiave);
    if (e) return e;
    const p = prove.get(a.chiave);
    if (!p) return "…";
    if (p.nome !== (nuovi.get(a.chiave) ?? "").trim()) return "da riprovare";
    if (!p.r.ok) return `✕ ${p.r.errore}`;
    return p.r.esito.esito === "uguale" ? "uguale: niente da fare" : "prova: si può";
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && lavoro === null) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">Rinomina · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            Cambia il nome mostrato in Zabbix e nella pagina del cliente. Il nome che l&apos;agente dichiara non si tocca. Proposto: il nome di DA-IPAM.
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[13px] text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Nome in Zabbix</th>
                <th className="px-2 py-1.5 font-semibold">Nuovo nome</th>
                <th className="px-2 py-1.5 font-semibold">Esito</th>
              </tr>
            </thead>
            <tbody>
              {apparati.map((a) => (
                <tr key={a.chiave} className="border-t">
                  <td className="px-2 py-1.5 font-mono text-[13px]">{a.nome}</td>
                  <td className="px-2 py-1.5">
                    <Input
                      className="h-8 w-64"
                      aria-label={`Nuovo nome di ${a.nome}`}
                      maxLength={128}
                      value={nuovi.get(a.chiave) ?? ""}
                      disabled={lavoro !== null || esiti !== null}
                      onChange={(e) => setNuovi((p) => new Map(p).set(a.chiave, e.target.value))}
                    />
                  </td>
                  <td className="px-2 py-1.5">{(() => { const t = esito(a); return t.startsWith("✕") ? <span className="font-semibold">{t}</span> : t; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          <Button type="button" variant="ghost" disabled={lavoro !== null} onClick={chiudi}>{esiti ? "Chiudi" : "Annulla"}</Button>
          {!esiti && (
            <>
              <Button type="button" variant="outline" disabled={lavoro !== null} onClick={() => void riprova()}>
                {lavoro === "prova" && <Loader2 className="mr-1 size-4 animate-spin" />}Prova di nuovo
              </Button>
              <Button type="button" disabled={lavoro !== null || daScrivere.length === 0} onClick={() => void applica()}>
                {lavoro === "applica" && <Loader2 className="mr-1 size-4 animate-spin" />}Rinomina {daScrivere.length}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sospendere, riattivare, togliere (26/11/2026) ──

function FinestraStato({ attivo, apparati, chiudi, fatto }: { attivo: boolean; apparati: ApparatoElenco[]; chiudi: () => void; fatto: () => void }) {
  const [lavoro, setLavoro] = useState(false);
  const [esiti, setEsiti] = useState<Map<string, string> | null>(null);

  async function applica() {
    setLavoro(true);
    const m = new Map<string, string>();
    for (const a of apparati) {
      const r = await postaConAttesa<EsitoStato>("/api/zabbix/apparati/stato", { hostid: a.hostid, attivo });
      m.set(a.chiave, r.ok ? (r.data.esito === "gia_cosi" ? "era già così" : attivo ? "riattivato" : "sospeso") : r.message);
      setEsiti(new Map(m));
    }
    setLavoro(false);
    fatto();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !lavoro) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">{attivo ? "Riattiva" : "Sospendi"} · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            {attivo
              ? "Zabbix riprende a interrogarli e a dare allarmi. Configurazione e storico sono rimasti com'erano."
              : "Restano in Zabbix con configurazione e storico, ma Zabbix non li interroga più e non dà allarmi. Si torna indietro con «Riattiva»."}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          <ul className="divide-y text-sm">
            {apparati.map((a) => (
              <li key={a.chiave} className="flex gap-3 py-1.5">
                <span className="w-56 min-w-0 truncate font-medium">{a.nome}</span>
                <span className="w-32 font-mono text-[13px]">{a.ip ?? "—"}</span>
                <span className="flex-1 text-muted-foreground">{esiti?.get(a.chiave) ?? (nonVisto(a) ? `DA-IPAM non lo vede da ${a.nonVistoGiorni} giorni` : "")}</span>
              </li>
            ))}
          </ul>
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {!esiti && (
            <Button type="button" disabled={lavoro} onClick={() => void applica()}>
              {lavoro && <Loader2 className="mr-1 size-4 animate-spin" />}{attivo ? "Riattiva" : "Sospendi"} {apparati.length}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={lavoro} onClick={chiudi}>{esiti ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinestraTogli({ apparati, chiudi, fatto, sospendiInvece }: { apparati: ApparatoElenco[]; chiudi: () => void; fatto: () => void; sospendiInvece: () => void }) {
  const [lavoro, setLavoro] = useState(false);
  const [letto, setLetto] = useState(false);
  const [esiti, setEsiti] = useState<Map<string, string> | null>(null);
  const daSospendere = apparati.filter((a) => a.stato !== "sospeso").length;

  async function applica() {
    setLavoro(true);
    const m = new Map<string, string>();
    for (const a of apparati) {
      const r = await postaConAttesa<EsitoTogli>("/api/zabbix/apparati/togli", { hostid: a.hostid });
      m.set(a.chiave, r.ok ? "tolto da Zabbix" : r.message);
      setEsiti(new Map(m));
    }
    setLavoro(false);
    fatto();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !lavoro) chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">Togli da Zabbix · {apparati.length} apparati</DialogTitle>
          <DialogDescription>
            Zabbix cancella l&apos;apparato con tutte le sue misure e il suo storico: <strong>non si torna indietro</strong>. In DA-IPAM
            l&apos;apparato resta e torna fra quelli da aggiungere. Se può tornare, sospendilo.
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="space-y-3 px-4 py-3">
          <ul className="divide-y text-sm">
            {apparati.map((a) => (
              <li key={a.chiave} className="flex gap-3 py-1.5">
                <span className="w-56 min-w-0 truncate font-semibold">{a.nome}</span>
                <span className="w-32 font-mono text-[13px]">{a.ip ?? "—"}</span>
                <span className="flex-1 text-muted-foreground">
                  {esiti?.get(a.chiave) ?? (a.stato === "sospeso" ? "sospeso" : nonVisto(a) ? `DA-IPAM non lo vede da ${a.nonVistoGiorni} giorni` : "risponde in DA-IPAM")}
                </span>
              </li>
            ))}
          </ul>
          {!esiti && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={letto} onChange={(e) => setLetto(e.target.checked)} />
              Ho letto i nomi: voglio cancellare da Zabbix questi {apparati.length} apparati e il loro storico.
            </label>
          )}
        </DialogScrollableArea>
        <DialogFooter className="border-t px-4 py-3">
          {!esiti && (
            <>
              <Button type="button" variant="outline" disabled={lavoro || !daSospendere} title={daSospendere ? undefined : "Sono già tutti sospesi"} onClick={sospendiInvece}>Sospendi invece</Button>
              <Button type="button" variant="destructive" disabled={lavoro || !letto} onClick={() => void applica()}>
                {lavoro && <Loader2 className="mr-1 size-4 animate-spin" />}Togli {apparati.length} da Zabbix
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" disabled={lavoro} onClick={chiudi}>{esiti ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── La pagina ──

// Dal 26/11 l'aggiunta va in coda entro i tetti del centro: si possono scegliere tutti gli apparati di una rete.
const MASSIMO_SELEZIONE = 500;
const PER_PAGINA = 100;
const CAMPO = "h-8 rounded-md border bg-background px-2 text-sm";

type Finestra =
  | { tipo: "aggiungi"; apparati: ApparatoElenco[]; giaProvati?: boolean }
  | { tipo: "agente"; apparati: ApparatoElenco[] }
  | { tipo: "famiglia"; apparati: ApparatoElenco[]; automatico?: boolean }
  | { tipo: "proponi"; apparati: ApparatoElenco[] }
  | { tipo: "rinomina"; apparati: ApparatoElenco[] }
  | { tipo: "modelli"; cambio: CambioModelli }
  | { tipo: "stato"; attivo: boolean; apparati: ApparatoElenco[] }
  | { tipo: "togli"; apparati: ApparatoElenco[] }
  | { tipo: "colonne" }
  | null;

/** Le azioni possibili su un insieme di apparati: le stesse per i pulsanti e per il tasto destro. */
function azioniSu(lista: ApparatoElenco[], scrive: boolean, motivo: string | undefined, apri: (f: Finestra) => void, centroVecchio: string | null) {
  // Un provvisorio è già stato scritto: non si aggiunge due volte.
  const daAggiungere = lista.filter((a) => a.hostid === null && !a.provvisorio);
  const monitorati = lista.filter((a) => a.hostid !== null);
  const sospesi = monitorati.filter((a) => a.stato === "sospeso");
  const attivi = monitorati.filter((a) => a.stato !== "sospeso");
  // Diverso dal nome di DA-IPAM: lo conta «Rinomina». Chi DA-IPAM non conosce non ha un nome da proporre.
  const daRinominare = monitorati.filter((a) => a.nomeIpam && a.nomeIpam !== a.nome);
  const perche = (vuoto: boolean, cosa: string) => (!scrive ? motivo ?? "Non si può scrivere sul centro" : vuoto ? cosa : undefined);
  // I pulsanti nuovi si spengono solo se il centro ha risposto 404 a una rotta nuova.
  const nuovo = (vuoto: boolean, cosa: string) => perche(vuoto, cosa) ?? centroVecchio ?? undefined;
  return [
    { id: "aggiungi", testo: `Aggiungi a Zabbix (${daAggiungere.length})`, spento: perche(!daAggiungere.length, "Nessuno dei selezionati è da aggiungere"), fai: () => apri({ tipo: "aggiungi", apparati: daAggiungere }) },
    { id: "modello_piu", testo: "Aggiungi un modello…", spento: perche(!monitorati.length, "Vale per chi è già in Zabbix"), fai: () => apri({ tipo: "modelli", cambio: { tipo: "aggiungi", apparati: monitorati } }) },
    { id: "modello_meno", testo: "Togli un modello…", spento: perche(!monitorati.length, "Vale per chi è già in Zabbix"), fai: () => apri({ tipo: "modelli", cambio: { tipo: "togli", apparati: monitorati } }) },
    { id: "proponi", testo: `Proponi i modelli… (${monitorati.length})`, spento: nuovo(!monitorati.length, "Vale per chi è già in Zabbix"), fai: () => apri({ tipo: "proponi", apparati: monitorati }) },
    { id: "famiglia", testo: "Cambia famiglia…", spento: perche(!monitorati.length, "Vale per chi è già in Zabbix"), fai: () => apri({ tipo: "famiglia", apparati: monitorati }) },
    { id: "agente", testo: "Prepara l'agente…", spento: perche(!lista.some((a) => a.sistema), "Serve solo a Windows e Linux"), fai: () => apri({ tipo: "agente", apparati: lista }) },
    { id: "rinomina", testo: `Rinomina… (${daRinominare.length})`, spento: nuovo(!daRinominare.length, "Vale per chi è in Zabbix con un nome diverso da quello di DA-IPAM"), fai: () => apri({ tipo: "rinomina", apparati: daRinominare }) },
    { id: "sospendi", testo: `Sospendi… (${attivi.length})`, spento: perche(!attivi.length, "Vale per chi è in Zabbix e non è già sospeso"), fai: () => apri({ tipo: "stato", attivo: false, apparati: attivi }) },
    { id: "riattiva", testo: `Riattiva… (${sospesi.length})`, spento: perche(!sospesi.length, "Vale per chi è sospeso"), fai: () => apri({ tipo: "stato", attivo: true, apparati: sospesi }) },
    { id: "togli", testo: `Togli da Zabbix… (${monitorati.length})`, spento: perche(!monitorati.length, "Vale per chi è già in Zabbix"), fai: () => apri({ tipo: "togli", apparati: monitorati }) },
  ];
}

function FinestraColonne({ vista, diSerie, cambia, chiudi }: { vista: Vista; diSerie: Vista; cambia: (v: Vista) => void; chiudi: () => void }) {
  const nascoste = COLONNE.filter((c) => !vista.colonne.includes(c.id));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) chiudi(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colonne</DialogTitle>
          <DialogDescription>Quali si vedono e in che ordine. La scelta resta salvata per il tuo utente.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {vista.colonne.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-md border px-2 py-1">
              <input type="checkbox" checked disabled={colonna(id).fissa} aria-label={`Mostra ${colonna(id).etichetta}`} onChange={() => cambia(conColonna(vista, id, false))} />
              <span className="flex-1 font-medium">{colonna(id).etichetta}{colonna(id).fissa && <span className="ml-2 text-[13px] font-normal text-muted-foreground">sempre visibile</span>}</span>
              <Button size="sm" variant="ghost" title="Sposta prima" disabled={i === 0} onClick={() => cambia(spostaColonna(vista, id, -1))}><ArrowUp className="size-4" /></Button>
              <Button size="sm" variant="ghost" title="Sposta dopo" disabled={i === vista.colonne.length - 1} onClick={() => cambia(spostaColonna(vista, id, 1))}><ArrowDown className="size-4" /></Button>
            </li>
          ))}
          {nascoste.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1 text-muted-foreground">
              <input type="checkbox" checked={false} aria-label={`Mostra ${c.etichetta}`} onChange={() => cambia(conColonna(vista, c.id, true))} />
              <span className="flex-1">{c.etichetta}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => cambia({ ...diSerie, gruppo: vista.gruppo })}>Come all&apos;inizio</Button>
          <Button onClick={chiudi}>Fatto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Cella({ id, a, versioneCentro }: { id: IdColonna; a: ApparatoElenco; versioneCentro: string | null }) {
  const vuoto = <span className="text-muted-foreground">—</span>;
  switch (id) {
    case "stato":
      // Provvisorio dichiarato: scritto ora in Zabbix, la lettura del centro non lo mostra ancora.
      if (a.provvisorio) return <span title={a.provvisorio}><Badge tono="da_verificare" testo="Aggiunto ora" /></span>;
      return <span title={a.motivo ?? undefined}>{a.stato === "sospeso" ? <BadgeSospeso /> : <Badge tono={TONO[a.stato]} testo={TESTO_STATO[a.stato]} />}</span>;
    case "nonVisto":
      // Segno e parola: il triangolo dice «da guardare», i giorni dicono da quanto.
      return nonVisto(a) ? <span className="font-semibold">▲ {a.nonVistoGiorni} giorni</span> : vuoto;
    case "nome":
      return a.schedaIpam ? <Link href={`/hosts/${a.schedaIpam}`} className="font-semibold hover:underline">{a.nome}</Link> : <span className="font-semibold">{a.nome}</span>;
    case "ip":
      return a.ip ? <span className="font-mono text-[13px]">{a.ip}</span> : vuoto;
    case "famiglia":
      return <span>{a.famiglia}{a.famigliaForzata && <SegnoAMano />}</span>;
    case "modelloZabbix":
      return a.modelli[0] ? <span>{a.modelli[0]}</span> : <span className="text-[13px] text-muted-foreground">{a.hostid ? "nessuno" : "lo propone il centro all'aggiunta"}</span>;
    case "altriModelli":
      return a.modelli.length > 1 ? <span title={a.modelli.slice(1).join("\n")} className="font-mono text-[13px]">+{a.modelli.length - 1}</span> : vuoto;
    case "agente": {
      const base = AGENTE[a.agente].tono ? <Badge tono={AGENTE[a.agente].tono!} testo={AGENTE[a.agente].testo} /> : <span className="text-[13px] text-muted-foreground">{AGENTE[a.agente].testo}</span>;
      const v = a.agenteVersione;
      if (!v) return base;
      const vecchio = piuVecchioDelCentro(v, versioneCentro);
      const installato = (
        <span>
          installato · <span className="font-mono text-[13px]">{v}</span>
          {vecchio && <span className="ml-1 font-semibold" title="più vecchio del centro" aria-label="più vecchio del centro">▲</span>}
        </span>
      );
      // Un agente che manda dati è «installato · versione»; negli altri stati il badge resta e la versione gli sta accanto.
      return a.agente === "si" ? installato : <span className="inline-flex items-center gap-2">{base}{installato}</span>;
    }
    case "credenziale":
      // Segno e parola: pieno quando DA-IPAM ha una credenziale provata valida, triangolo quando non ne ha.
      return a.credenziali.length ? <span>● {a.credenziali.join(", ")}</span> : a.schedaIpam ? <span className="text-muted-foreground">▲ nessuna</span> : vuoto;
    case "problemi":
      return a.hostid ? <span className={a.problemi ? "font-semibold" : "text-muted-foreground"}>{a.problemi}</span> : vuoto;
    case "mac":
      return a.mac ? <span className="font-mono text-[13px]">{a.mac}</span> : vuoto;
    default: {
      const t = colonna(id).testo(a);
      return t ? <span>{t}</span> : vuoto;
    }
  }
}

/** I pulsanti della scheda «Agenti»: scelgono lo stato dell'agente, al posto di quelli dello stato dell'apparato. */
const STATI_AGENTE: ReadonlyArray<{ id: StatoAgente | ""; etichetta: string }> = [
  { id: "", etichetta: "Tutti" },
  { id: "da_installare", etichetta: "Da installare" },
  { id: "no", etichetta: "Non manda dati" },
  { id: "si", etichetta: "Attivo" },
  { id: "non_so", etichetta: "Non so" },
];

/** La scheda di lato dell'apparato scelto: quello che si sa e le azioni su di lui solo. */
function SchedaApparato({ a, scrive, motivo, apri, chiudi, centroVecchio, versioneCentro }: {
  a: ApparatoElenco;
  scrive: boolean;
  motivo: string | undefined;
  apri: (f: Finestra) => void;
  chiudi: () => void;
  centroVecchio: string | null;
  versioneCentro: string | null;
}) {
  const vecchio = piuVecchioDelCentro(a.agenteVersione, versioneCentro);
  return (
    <aside className="w-[380px] shrink-0 self-start">
      <SchedaDettaglio
        etichetta={a.hostid ? "In Zabbix" : "Non ancora in Zabbix"}
        titolo={a.nome}
        vuoto=""
        azioni={
          <>
            {azioniSu([a], scrive, motivo, apri, centroVecchio)
              .filter((z) => !z.spento || z.id === "agente" || (z.id === "aggiungi") === (a.hostid === null))
              .filter((z) => (z.id === "aggiungi") === (a.hostid === null) || z.id === "agente")
              .map((z) => <Button key={z.id} size="sm" variant="outline" disabled={!!z.spento} title={z.spento} onClick={z.fai}>{z.id === "aggiungi" ? "Aggiungi a Zabbix…" : z.id === "proponi" || z.id === "rinomina" ? z.testo.replace(/ \(\d+\)$/, "") : z.testo}</Button>)}
            {a.schedaIpam && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/hosts/${a.schedaIpam}`} />}>Apri la scheda in DA-IPAM</Button>}
            <Button size="sm" variant="ghost" onClick={chiudi}>Chiudi la scheda</Button>
          </>
        }
      >
        <DatoDettaglio nome="Stato" valore={<>{a.provvisorio ? <Badge tono="da_verificare" testo="Aggiunto ora" /> : a.stato === "sospeso" ? <BadgeSospeso /> : <Badge tono={TONO[a.stato]} testo={TESTO_STATO[a.stato]} />}{(a.provvisorio ?? a.motivo) && <span className="ml-2 font-normal">{a.provvisorio ?? a.motivo}</span>}</>} />
        <DatoDettaglio nome="IP" valore={a.ip} mono />
        {a.hostTecnico && <DatoDettaglio nome="Nome in Zabbix (quello che l'agente dichiara)" valore={a.hostTecnico} mono />}
        <DatoDettaglio
          nome="Famiglia"
          valore={
            <>
              {a.famiglia}
              {a.famigliaForzata && <SegnoAMano />}
              {a.famigliaForzata && (
                <div className="mt-1">
                  <Button size="sm" variant="outline" disabled={!scrive} title={scrive ? "La famiglia torna a deciderla il centro" : motivo} onClick={() => apri({ tipo: "famiglia", apparati: [a], automatico: true })}>
                    Torna all&apos;automatico
                  </Button>
                </div>
              )}
            </>
          }
        />
        <DatoDettaglio
          nome={`Modelli in Zabbix · ${a.modelli.length}`}
          valore={a.modelli.length ? (
            <ul className="font-normal">
              {a.modelli.map((m) => (
                <li key={m} className="flex items-center gap-2 py-0.5">
                  <span className="min-w-0 flex-1">{m}</span>
                  <Button size="sm" variant="outline" disabled={!scrive || !a.hostid} title={scrive ? `Togli «${m}» da questo apparato` : motivo} onClick={() => apri({ tipo: "modelli", cambio: { tipo: "togli", apparati: [a], modello: m } })}>Togli</Button>
                </li>
              ))}
            </ul>
          ) : a.hostid ? "nessuno" : "li propone il centro all'aggiunta"}
        />
        <DatoDettaglio nome="Agente" valore={<>{TESTO_AGENTE[a.agente]}{a.sistema && <span className="ml-2 font-normal text-muted-foreground">{a.sistema === "windows" ? "Windows" : "Linux"}</span>}</>} />
        {a.agenteVersione && (
          <DatoDettaglio
            nome="Versione dell'agente"
            valore={<><span className="font-mono">{a.agenteVersione}</span>{vecchio && <span className="ml-2 font-normal" title="più vecchio del centro">▲ più vecchio del centro ({versioneCentro})</span>}</>}
          />
        )}
        <DatoDettaglio nome="Credenziale valida in DA-IPAM" valore={a.credenziali.length ? a.credenziali.join(", ") : a.schedaIpam ? "nessuna" : "—"} />
        {a.hostid && <DatoDettaglio nome="Proxy" valore={a.proxy} />}
        {a.hostid && <DatoDettaglio nome="Problemi aperti" valore={a.problemi} />}
        {nonVisto(a) && <DatoDettaglio nome="DA-IPAM non lo vede rispondere da" valore={`▲ ${a.nonVistoGiorni} giorni: se non c'è più, sospendilo`} />}
        <DatoDettaglio nome="Rete" valore={a.rete ? testoRete(a) : null} />
        <DatoDettaglio nome="Marca e modello" valore={[a.marca, a.modello].filter(Boolean).join(" · ") || null} />
        {a.mac && <DatoDettaglio nome="MAC" valore={a.mac} mono />}
      </SchedaDettaglio>
    </aside>
  );
}

export function ApparatiDatia({ modo = "apparati" }: { modo?: "apparati" | "agenti" }) {
  const agenti = modo === "agenti";
  const CHIAVE_VISTA = agenti ? "zabbix-agenti-vista" : "zabbix-apparati-vista";
  const diSerie = agenti ? VISTA_AGENTI : VISTA_DI_SERIE;
  const [aperto, setAperto] = useState<string | null>(null);
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtri, setFiltri] = useState<Filtri>(FILTRI_VUOTI);
  const [vista, setVista] = useState<Vista>(diSerie);
  const [chiusi, setChiusi] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(0);
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  // La riga sotto il tasto destro: il menu è uno solo per tutta la tabella.
  const [bersaglio, setBersaglio] = useState<string | null>(null);
  // Le finestre ricevono una copia degli apparati fissata all'apertura: l'elenco si rilegge sotto di loro.
  const [finestra, setFinestra] = useState<Finestra>(null);
  const [coda, setCoda] = useState<string[]>([]);
  // Appena aggiunti e non ancora nella lettura del centro: restano visibili con lo stato provvisorio dichiarato.
  const [provvisori, setProvvisori] = useState<Map<string, ApparatoElenco>>(new Map());
  // Il centro ha risposto 404 a una rotta nuova: i pulsanti nuovi si spengono col motivo.
  const [centroVecchio, setCentroVecchio] = useState<string | null>(null);
  const segnalaErrore = useCallback((messaggio: string) => { if (messaggio === TESTO_CENTRO_VECCHIO) setCentroVecchio(TESTO_CENTRO_VECCHIO); }, []);
  useEffect(() => { if (!finestra) setCoda(codaSalvata().chiavi); }, [finestra]);

  const carica = useCallback(async () => {
    const r = await fetchJson<Risposta>("/api/zabbix/apparati", { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, []);
  useEffect(() => { void carica(); }, [carica]);
  useEffect(() => {
    void fetchJson<{ value: string | null }>(`/api/user/preferences?key=${CHIAVE_VISTA}`, { cache: "no-store" }).then((r) => {
      if (r.ok && r.data.value) setVista(leggiVista(r.data.value, diSerie));
    });
    // Dalla scheda «Modelli» si arriva con il modello già scelto nell'indirizzo.
    const q = new URLSearchParams(window.location.search);
    const scelte: Filtri["scelte"] = {};
    if (q.get("modello")) scelte.modelloZabbix = q.get("modello") ?? "";
    if (q.get("famiglia")) scelte.famiglia = q.get("famiglia") ?? "";
    if (Object.keys(scelte).length) setFiltri((f) => ({ ...f, scelte: { ...f.scelte, ...scelte } }));
  }, [CHIAVE_VISTA, diSerie]);

  function cambiaVista(v: Vista) {
    setVista(v);
    setPagina(0);
    void fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: CHIAVE_VISTA, value: JSON.stringify(v) }),
    }).then((r) => { if (!r.ok) toast.error("La vista non è stata salvata: alla prossima apertura torna quella di prima"); })
      .catch(() => toast.error("La vista non è stata salvata: alla prossima apertura torna quella di prima"));
  }
  function cambiaFiltri(f: Filtri) {
    setFiltri(f);
    setPagina(0);
  }

  // Nella scheda «Agenti» ci sono solo gli apparati a cui un agente serve.
  const unite = useMemo(() => conProvvisori(dati?.apparati ?? [], provvisori), [dati, provvisori]);
  useEffect(() => {
    if (unite.superati.length) setProvvisori((p) => { const n = new Map(p); for (const k of unite.superati) n.delete(k); return n; });
  }, [unite.superati]);
  const apparati = useMemo(() => unite.elenco.filter((a) => !agenti || a.agente !== "non_serve"), [unite, agenti]);
  const famiglie = useMemo(() => dati?.famiglie ?? [], [dati]);
  const visibili = useMemo(() => apparati.filter((a) => passa(a, filtri)), [apparati, filtri]);
  const gruppi = useMemo(() => raggruppa(visibili, vista, famiglie), [visibili, vista, famiglie]);
  // Una pagina sono 100 righe aperte: i gruppi richiusi non ne consumano.
  const righe = useMemo(() => gruppi.flatMap((g) => (chiusi.has(g.chiave) ? [] : g.lista.map((a) => ({ g, a })))), [gruppi, chiusi]);
  const pagine = Math.max(1, Math.ceil(righe.length / PER_PAGINA));
  const inPagina = righe.slice(pagina * PER_PAGINA, (pagina + 1) * PER_PAGINA);
  const chiaviInPagina = new Set(inPagina.map((r) => r.a.chiave));

  const selezionati = apparati.filter((a) => scelti.has(a.chiave));
  const scrive = dati?.scrittura?.possibile === true;
  const motivo = dati?.scrittura?.motivo;
  const sottoIlMenu = bersaglio && !scelti.has(bersaglio) ? apparati.filter((a) => a.chiave === bersaglio) : selezionati;
  const rigaMenu = apparati.find((a) => a.chiave === bersaglio) ?? null;
  const apertoOra = apparati.find((a) => a.chiave === aperto) ?? null;
  // La coda lasciata a metà (tetto del giorno, o fermata): vale per chi è ancora da aggiungere.
  const inCoda = apparati.filter((a) => a.hostid === null && !a.provvisorio && coda.includes(a.chiave));

  function scegli(lista: ApparatoElenco[], si: boolean) {
    setScelti((p) => {
      const n = new Set(p);
      for (const a of lista) {
        if (si && n.size < MASSIMO_SELEZIONE) n.add(a.chiave);
        if (!si) n.delete(a.chiave);
      }
      return n;
    });
  }
  function dopoScrittura() {
    setScelti(new Set());
    void carica();
  }
  function dopoAggiunta(aggiunti: ApparatoElenco[]) {
    if (aggiunti.length) setProvvisori((p) => { const n = new Map(p); for (const a of aggiunti) n.set(a.chiave, a); return n; });
    dopoScrittura();
  }
  function ordinaPer(id: IdColonna) {
    cambiaVista({ ...vista, ordine: { colonna: id, verso: vista.ordine.colonna === id && vista.ordine.verso === "su" ? "giu" : "su" } });
  }
  function apriChiudi(chiave: string) {
    setChiusi((p) => { const n = new Set(p); if (n.has(chiave)) n.delete(chiave); else n.add(chiave); return n; });
    setPagina(0);
  }

  if (errore) return <LoadError what="gli apparati" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Carico…</p>;
  if (!dati.letto) return <Vuoto titolo="Il centro non si legge" testo={dati.motivo} azione={<Button size="sm" variant="outline" nativeButton={false} render={<Link href="/settings/moduli/zabbix" />}>Apri la configurazione</Button>} />;

  const accesi = CAMPI_FILTRO.filter((c) => filtri.scelte[c.id]).length + (filtri.stato !== "tutti" ? 1 : 0) + (filtri.testo.trim() ? 1 : 0);
  const proxy = dati.proxy ?? [];
  const larghezza = vista.colonne.length + 1;

  return (
    <div className="space-y-2">
      <BarraStato
        acceso={scrive}
        titolo="Zabbix"
        stato={scrive ? "si legge e si scrive" : "sola lettura"}
        dettagli={[
          ...(dati.vecchio ? ["dati vecchi"] : []),
          ...proxy.map((p) => `proxy ${p.nome}: ${p.inLinea ? "in linea" : "non in linea"}`),
          ...(scrive ? [] : [motivo ?? "manca la chiave di scrittura"]),
        ]}
        azioni={
          <>
            {!scrive && <Button size="sm" nativeButton={false} render={<Link href="/settings/moduli/zabbix" />}>Inserisci la chiave</Button>}
            <Button size="sm" variant="outline" onClick={() => void carica()}><RefreshCw className="mr-1 size-4" />Rileggi</Button>
          </>
        }
      />

      <div className="space-y-2 rounded-xl border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-64" placeholder="Cerca nome, IP, MAC, marca, modello" value={filtri.testo} onChange={(e) => cambiaFiltri({ ...filtri, testo: e.target.value })} />
          {!agenti && STATI.map((s) => (
            <Button key={s.id} size="sm" variant={filtri.stato === s.id ? "default" : "outline"} aria-pressed={filtri.stato === s.id} onClick={() => cambiaFiltri({ ...filtri, stato: s.id })}>
              {s.etichetta} <span className="ml-1 font-mono">{apparati.filter(s.vale).length}</span>
            </Button>
          ))}
          {agenti && STATI_AGENTE.map((s) => {
            const scelto = (filtri.scelte.agente ?? "") === (s.id ? TESTO_AGENTE[s.id] : "");
            return (
              <Button key={s.id || "tutti"} size="sm" variant={scelto ? "default" : "outline"} aria-pressed={scelto} onClick={() => cambiaFiltri({ ...filtri, scelte: { ...filtri.scelte, agente: s.id ? TESTO_AGENTE[s.id] : "" } })}>
                {s.etichetta} <span className="ml-1 font-mono">{s.id ? apparati.filter((a) => a.agente === s.id).length : apparati.length}</span>
              </Button>
            );
          })}
          <span className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-[13px] text-muted-foreground">
              Raggruppa per
              <select className={CAMPO} value={vista.gruppo} onChange={(e) => { setChiusi(new Set()); cambiaVista({ ...vista, gruppo: e.target.value as IdGruppo }); }}>
                {GRUPPI.map((g) => <option key={g.id} value={g.id}>{g.etichetta}</option>)}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => setFinestra({ tipo: "colonne" })}><Columns3 className="mr-1 size-4" />Colonne</Button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CAMPI_FILTRO.filter((c) => !agenti || c.id !== "agente").map((c) => {
            const scelto = filtri.scelte[c.id] ?? "";
            return (
              <select
                key={c.id}
                aria-label={`Filtra per ${c.etichetta}`}
                className={`${CAMPO} max-w-64 ${scelto ? "border-2 border-foreground font-semibold" : ""}`}
                value={scelto}
                onChange={(e) => cambiaFiltri({ ...filtri, scelte: { ...filtri.scelte, [c.id]: e.target.value } })}
              >
                <option value="">{c.etichetta}: tutti</option>
                {valoriFiltro(apparati, c.id).map((v) => (
                  <option key={v.valore} value={v.valore}>{v.valore === NESSUNO ? "(nessuno)" : v.valore} · {v.quanti}</option>
                ))}
              </select>
            );
          })}
          <Button size="sm" variant="ghost" disabled={accesi === 0} onClick={() => cambiaFiltri(FILTRI_VUOTI)}>Togli i filtri</Button>
          <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">{visibili.length} di {apparati.length} apparati</span>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
        <span className="text-sm font-semibold">{selezionati.length} selezionati</span>
        {azioniSu(selezionati, scrive, motivo, setFinestra, centroVecchio).map((z, i) => (
          <Button key={z.id} size="sm" variant={i === 0 && !z.spento ? "default" : "outline"} disabled={!!z.spento} title={z.spento} onClick={z.fai}>{z.testo}</Button>
        ))}
        <Button size="sm" variant="ghost" disabled={!selezionati.length} onClick={() => setScelti(new Set())}>Togli la selezione</Button>
        {inCoda.length > 0 && (
          <>
            <Button size="sm" disabled={!scrive} title={scrive ? "Aggiunge quelli rimasti dall'ultima aggiunta in massa" : motivo} onClick={() => setFinestra({ tipo: "aggiungi", apparati: inCoda, giaProvati: true })}>Riprendi la coda ({inCoda.length})</Button>
            <Button size="sm" variant="ghost" onClick={() => { salvaCoda({ ...codaSalvata(), chiavi: [] }); setCoda([]); }}>Svuota la coda</Button>
          </>
        )}
        {scelti.size >= MASSIMO_SELEZIONE && <span className="text-[13px] text-muted-foreground">Al massimo {MASSIMO_SELEZIONE} alla volta.</span>}
        <span className="ml-auto text-[13px] text-muted-foreground">Tasto destro su una riga: le stesse azioni</span>
      </div>

      <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
      {gruppi.length === 0 ? (
        <Vuoto titolo="Nessun apparato" testo={accesi ? "Nessuno corrisponde ai filtri." : undefined} azione={accesi ? <Button size="sm" variant="outline" onClick={() => cambiaFiltri(FILTRI_VUOTI)}>Togli i filtri</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <ContextMenu onOpenChange={(o) => { if (!o) setBersaglio(null); }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 text-left text-[13px] text-muted-foreground">
                  <th className="w-8 px-2 py-1.5">
                    <input type="checkbox" aria-label="Scegli le righe di questa pagina" checked={inPagina.length > 0 && inPagina.every((r) => scelti.has(r.a.chiave))} onChange={(e) => scegli(inPagina.map((r) => r.a), e.target.checked)} />
                  </th>
                  {vista.colonne.map((id) => (
                    <th key={id} className="whitespace-nowrap px-2 py-1.5 font-semibold" aria-sort={vista.ordine.colonna === id ? (vista.ordine.verso === "su" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="hover:underline" title={`Ordina per ${colonna(id).etichetta}`} onClick={() => ordinaPer(id)}>
                        {colonna(id).etichetta}{vista.ordine.colonna === id ? (vista.ordine.verso === "su" ? " ▲" : " ▼") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <ContextMenuTrigger render={<tbody />}>
                {gruppi.map((g) => {
                  // I gruppi restano nel loro ordine: quelli richiusi mostrano la sola testata, gli altri le righe di questa pagina.
                  const chiuso = chiusi.has(g.chiave);
                  const sue = chiuso ? [] : inPagina.filter((r) => r.g === g);
                  if (!chiuso && sue.length === 0) return null;
                  return (
                    <Fragment key={g.chiave}>
                      {vista.gruppo !== "nessuno" && <RigaGruppo g={g} chiuso={chiuso} larghezza={larghezza} scelti={scelti} scegli={scegli} apriChiudi={apriChiudi} />}
                      {sue.map(({ a }) => (
                        <tr
                          key={a.chiave}
                          title="Clic: apre la scheda di lato"
                          aria-selected={aperto === a.chiave}
                          className={`cursor-pointer border-t hover:bg-muted/50 ${scelti.has(a.chiave) ? "bg-primary/10" : ""} ${aperto === a.chiave ? "outline-2 -outline-offset-2 outline-foreground" : ""}`}
                          onContextMenu={() => setBersaglio(a.chiave)}
                          onClick={(e) => { if (!(e.target as HTMLElement).closest("a,input,button")) setAperto(aperto === a.chiave ? null : a.chiave); }}
                        >
                          <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Scegli ${a.nome}`} checked={scelti.has(a.chiave)} onChange={(e) => scegli([a], e.target.checked)} /></td>
                          {vista.colonne.map((id) => <td key={id} className="whitespace-nowrap px-2 py-1.5"><Cella id={id} a={a} versioneCentro={dati.versioneCentro ?? null} /></td>)}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </ContextMenuTrigger>
            </table>
            <ContextMenuContent>
              {rigaMenu && (
                <ContextMenuGroup>
                  <ContextMenuLabel className="max-w-72 truncate">
                    {sottoIlMenu.length > 1 ? `${sottoIlMenu.length} selezionati` : rigaMenu.nome}
                  </ContextMenuLabel>
                </ContextMenuGroup>
              )}
              {azioniSu(sottoIlMenu, scrive, motivo, setFinestra, centroVecchio).map((z) => (
                <ContextMenuItem key={z.id} disabled={!!z.spento} title={z.spento} onClick={z.fai}>{z.testo}</ContextMenuItem>
              ))}
              {rigaMenu && (
                <>
                  <ContextMenuSeparator />
                  {rigaMenu.schedaIpam && <ContextMenuItem render={<Link href={`/hosts/${rigaMenu.schedaIpam}`} />}>Apri la scheda in DA-IPAM</ContextMenuItem>}
                  <ContextMenuItem onClick={() => cambiaFiltri({ ...filtri, scelte: { ...filtri.scelte, famiglia: rigaMenu.famiglia } })}>Filtra per famiglia «{rigaMenu.famiglia}»</ContextMenuItem>
                  {rigaMenu.rete && <ContextMenuItem onClick={() => cambiaFiltri({ ...filtri, scelte: { ...filtri.scelte, rete: testoRete(rigaMenu) } })}>Filtra per rete «{testoRete(rigaMenu)}»</ContextMenuItem>}
                  {rigaMenu.marca && <ContextMenuItem onClick={() => cambiaFiltri({ ...filtri, scelte: { ...filtri.scelte, marca: rigaMenu.marca ?? "" } })}>Filtra per marca «{rigaMenu.marca}»</ContextMenuItem>}
                  {rigaMenu.ip && (
                    <ContextMenuItem onClick={() => { void navigator.clipboard.writeText(rigaMenu.ip ?? "").then(() => toast.success("IP copiato"), () => toast.error("Il browser non ha lasciato copiare")); }}>Copia l&apos;IP</ContextMenuItem>
                  )}
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
          <div className="flex items-center gap-2 border-t px-3 py-2 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              Righe {righe.length ? pagina * PER_PAGINA + 1 : 0}–{Math.min((pagina + 1) * PER_PAGINA, righe.length)} di {righe.length}
              {righe.length < visibili.length ? ` (${visibili.length - righe.length} nei gruppi richiusi)` : ""}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>‹ Prima</Button>
              <span className="px-1 tabular-nums">Pagina {pagina + 1} di {pagine}</span>
              <Button size="sm" variant="outline" disabled={pagina >= pagine - 1} onClick={() => setPagina(pagina + 1)}>Dopo ›</Button>
            </span>
            {chiaviInPagina.size > 0 && scelti.size > 0 && ![...scelti].every((c) => chiaviInPagina.has(c)) && <span>Alcuni selezionati sono in altre pagine.</span>}
          </div>
        </div>
      )}
      </div>
      {apertoOra && <SchedaApparato a={apertoOra} scrive={scrive} motivo={motivo} apri={setFinestra} chiudi={() => setAperto(null)} centroVecchio={centroVecchio} versioneCentro={dati.versioneCentro ?? null} />}
      </div>

      {finestra?.tipo === "aggiungi" && <FinestraAggiungi apparati={finestra.apparati} giaProvati={finestra.giaProvati} chiudi={() => setFinestra(null)} fatto={dopoAggiunta} />}
      {finestra?.tipo === "agente" && <FinestraAgente apparati={finestra.apparati} chiudi={() => setFinestra(null)} />}
      {finestra?.tipo === "famiglia" && <FinestraFamiglia apparati={finestra.apparati} famiglie={dati.famiglie ?? []} automatico={finestra.automatico} chiudi={() => setFinestra(null)} fatto={dopoScrittura} segnala={segnalaErrore} />}
      {finestra?.tipo === "proponi" && <FinestraProponi apparati={finestra.apparati} chiudi={() => setFinestra(null)} fatto={dopoScrittura} segnala={segnalaErrore} />}
      {finestra?.tipo === "rinomina" && <FinestraRinomina apparati={finestra.apparati} chiudi={() => setFinestra(null)} fatto={dopoScrittura} segnala={segnalaErrore} />}
      {finestra?.tipo === "modelli" && <FinestraModelli cambio={finestra.cambio} adatti={dati.modelliAdatti ?? null} chiudi={() => setFinestra(null)} fatto={dopoScrittura} />}
      {finestra?.tipo === "stato" && <FinestraStato attivo={finestra.attivo} apparati={finestra.apparati} chiudi={() => setFinestra(null)} fatto={dopoScrittura} />}
      {finestra?.tipo === "togli" && (
        <FinestraTogli
          apparati={finestra.apparati}
          chiudi={() => setFinestra(null)}
          fatto={dopoScrittura}
          sospendiInvece={() => setFinestra({ tipo: "stato", attivo: false, apparati: finestra.apparati.filter((a) => a.stato !== "sospeso") })}
        />
      )}
      {finestra?.tipo === "colonne" && <FinestraColonne vista={vista} diSerie={diSerie} cambia={cambiaVista} chiudi={() => setFinestra(null)} />}
    </div>
  );
}

/** La riga che apre un gruppo: nome, quanti, quanti in monitoraggio, e la scelta di tutto il gruppo. */
function RigaGruppo({ g, chiuso, larghezza, scelti, scegli, apriChiudi }: {
  g: Gruppo;
  chiuso: boolean;
  larghezza: number;
  scelti: Set<string>;
  scegli: (lista: ApparatoElenco[], si: boolean) => void;
  apriChiudi: (chiave: string) => void;
}) {
  const inZbx = g.lista.filter((a) => a.hostid).length;
  return (
    <tr className="border-t-2 border-foreground/60 bg-muted/60">
      <td className="px-2 py-1.5">
        <input type="checkbox" aria-label={`Scegli tutti: ${g.etichetta}`} checked={g.lista.every((a) => scelti.has(a.chiave))} onChange={(e) => scegli(g.lista, e.target.checked)} />
      </td>
      <td colSpan={larghezza - 1} className="px-2 py-1.5">
        <button type="button" className="font-semibold uppercase tracking-wide hover:underline" aria-expanded={!chiuso} onClick={() => apriChiudi(g.chiave)}>
          {chiuso ? "▸" : "▾"} {g.etichetta} <span className="font-mono">{g.lista.length}</span>
        </button>
        <span className="ml-3 text-[13px] text-muted-foreground">{inZbx} in monitoraggio · {g.lista.length - inZbx} da aggiungere</span>
      </td>
    </tr>
  );
}
