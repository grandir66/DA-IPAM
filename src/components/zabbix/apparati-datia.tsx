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
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import type { ApparatoElenco, StatoAgente, StatoApparato } from "@/lib/zabbix-lettura/apparati";
import type { EsitoAgente, EsitoModelli, EsitoScrittura } from "@/lib/zabbix-lettura/scrittura";

interface Risposta {
  letto: boolean;
  motivo?: string;
  lettoAlle?: string | null;
  vecchio?: boolean;
  famiglie?: Array<{ codice: string; etichetta: string }>;
  apparati?: ApparatoElenco[];
  modelliAdatti?: Record<string, string[]> | null;
  scrittura?: { possibile: boolean; motivo?: string };
}

type Scheda = "tutti" | "monitorati" | "da_aggiungere" | "agente";
const SCHEDE: Array<{ id: Scheda; etichetta: string; vale: (a: ApparatoElenco) => boolean }> = [
  { id: "tutti", etichetta: "Tutti", vale: () => true },
  { id: "monitorati", etichetta: "In monitoraggio", vale: (a) => a.hostid !== null },
  { id: "da_aggiungere", etichetta: "Da aggiungere", vale: (a) => a.hostid === null },
  { id: "agente", etichetta: "Agente da installare", vale: (a) => a.agente === "no" || a.agente === "da_installare" },
];

const TONO: Record<StatoApparato, ToniStato> = { funziona: "ok", attenzione: "attenzione", fermo: "guasto", non_so: "da_verificare", da_aggiungere: "grigio" };
const TESTO_STATO: Record<StatoApparato, string> = { funziona: "Funziona", attenzione: "Attenzione", fermo: "Fermo", non_so: "Non so", da_aggiungere: "Da aggiungere" };
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

type CambioModelli = { tipo: "aggiungi" | "togli"; apparati: ApparatoElenco[] };

function FinestraModelli({ cambio, adatti, chiudi, fatto }: { cambio: CambioModelli; adatti: Record<string, string[]> | null; chiudi: () => void; fatto: () => void }) {
  const [modello, setModello] = useState<string>("");
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

  async function prepara() {
    setLavoro(true);
    setErrore(null);
    const fuori: Array<{ titolo: string; comando: string; file: string }> = [];
    const chiedi = async (sistema: "windows" | "linux", hostname: string | null) =>
      postaConAttesa<EsitoAgente>("/api/zabbix/apparati/agente", { sistema, hostname });
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
    setComandi(fuori);
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

// ── Finestra «Aggiungi a Zabbix»: prova per ognuno, poi conferma ──

function FinestraAggiungi({ apparati, chiudi, fatto }: { apparati: ApparatoElenco[]; chiudi: () => void; fatto: () => void }) {
  const [righe, setRighe] = useState<Map<string, { ok: true; esito: EsitoScrittura } | { ok: false; errore: string }>>(new Map());
  const [fase, setFase] = useState<"prova" | "pronto" | "aggiungo" | "fatto">("prova");
  const [script, setScript] = useState<Array<{ titolo: string; comando: string; file: string }>>([]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const m = new Map<string, { ok: true; esito: EsitoScrittura } | { ok: false; errore: string }>();
      for (const a of apparati) {
        const r = await postaConAttesa<EsitoScrittura>(`/api/hosts/${a.hostIdIpam}/zabbix`, { prova: true });
        if (!vivo) return;
        m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
        setRighe(new Map(m));
      }
      if (vivo) setFase("pronto");
    })();
    return () => { vivo = false; };
  }, [apparati]);

  const accettati = apparati.filter((a) => { const r = righe.get(a.chiave); return r?.ok && r.esito.esito === "prova"; });

  async function aggiungi() {
    setFase("aggiungo");
    const m = new Map(righe);
    const s: Array<{ titolo: string; comando: string; file: string }> = [];
    for (const a of accettati) {
      const r = await postaConAttesa<EsitoScrittura>(`/api/hosts/${a.hostIdIpam}/zabbix`, {});
      m.set(a.chiave, r.ok ? { ok: true, esito: r.data } : { ok: false, errore: r.message });
      if (r.ok && r.data.esito === "serve_agente" && r.data.comando) {
        s.push({ titolo: r.data.host, comando: r.data.comando, file: `agente-zabbix-${r.data.host}.${r.data.sistema === "windows" ? "ps1" : "sh"}` });
      }
      setRighe(new Map(m));
    }
    setScript(s);
    setFase("fatto");
    fatto();
  }

  function testo(a: ApparatoElenco): string {
    const r = righe.get(a.chiave);
    if (!r) return "…";
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

  return (
    <Dialog open onOpenChange={(o) => { if (!o && fase !== "aggiungo") chiudi(); }}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle className="text-lg">Aggiungi a Zabbix · {apparati.length} apparati</DialogTitle>
          <DialogDescription>Prima il centro dice cosa farebbe per ognuno; si aggiungono solo quelli che accetta.</DialogDescription>
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
        <DialogFooter className="border-t px-4 py-3">
          {(fase === "prova" || fase === "pronto") && (
            <Button type="button" disabled={fase === "prova" || !accettati.length} onClick={() => void aggiungi()}>
              {fase === "prova" && <Loader2 className="mr-1 size-4 animate-spin" />}Aggiungi {accettati.length}
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={fase === "aggiungo"} onClick={chiudi}>{fase === "fatto" ? "Chiudi" : "Annulla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── La pagina ──

const MASSIMO_SELEZIONE = 50;

export function ApparatiDatia() {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scheda, setScheda] = useState<Scheda>("tutti");
  const [filtro, setFiltro] = useState("");
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  // Le finestre ricevono una copia degli apparati fissata all'apertura: l'elenco si rilegge sotto di loro.
  const [finestra, setFinestra] = useState<
    { tipo: "aggiungi"; apparati: ApparatoElenco[] } | { tipo: "agente"; apparati: ApparatoElenco[] } | { tipo: "modelli"; cambio: CambioModelli } | null
  >(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<Risposta>("/api/zabbix/apparati", { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, []);
  useEffect(() => { void carica(); }, [carica]);

  const apparati = useMemo(() => dati?.apparati ?? [], [dati]);
  const conteggi = useMemo(() => Object.fromEntries(SCHEDE.map((s) => [s.id, apparati.filter(s.vale).length])) as Record<Scheda, number>, [apparati]);
  const visibili = useMemo(() => {
    const vale = SCHEDE.find((s) => s.id === scheda)!.vale;
    const f = filtro.trim().toLowerCase();
    return apparati.filter((a) => vale(a) && (!f || `${a.nome} ${a.ip ?? ""} ${a.modelli.join(" ")}`.toLowerCase().includes(f)));
  }, [apparati, scheda, filtro]);
  const gruppi = useMemo(() => {
    const ordine = (dati?.famiglie ?? []).map((f) => f.codice);
    const etichetta = new Map((dati?.famiglie ?? []).map((f) => [f.codice, f.etichetta]));
    const per = new Map<string, ApparatoElenco[]>();
    for (const a of visibili) {
      const k = etichetta.has(a.famiglia) ? a.famiglia : "altro";
      per.set(k, [...(per.get(k) ?? []), a]);
    }
    return [...per.entries()]
      .sort((x, y) => (ordine.indexOf(x[0]) === -1 ? 99 : ordine.indexOf(x[0])) - (ordine.indexOf(y[0]) === -1 ? 99 : ordine.indexOf(y[0])))
      .map(([codice, lista]) => ({ codice, etichetta: etichetta.get(codice) ?? "Altro", lista: lista.sort((a, b) => a.nome.localeCompare(b.nome, "it")) }));
  }, [visibili, dati]);

  const selezionati = apparati.filter((a) => scelti.has(a.chiave));
  const daAggiungere = selezionati.filter((a) => a.hostid === null);
  const monitorati = selezionati.filter((a) => a.hostid !== null);
  const scrive = dati?.scrittura?.possibile === true;

  function scegli(chiave: string, si: boolean) {
    setScelti((p) => {
      const n = new Set(p);
      if (si && n.size < MASSIMO_SELEZIONE) n.add(chiave);
      else n.delete(chiave);
      return n;
    });
  }
  function scegliGruppo(lista: ApparatoElenco[], si: boolean) {
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

  if (errore) return <LoadError what="gli apparati" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Carico…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Apparati</h1>
        <p className="text-[13px] text-muted-foreground">Quelli in Zabbix e quelli da aggiungere, per famiglia. I cambi compaiono qui entro due minuti.</p>
        <Link href="/zabbix" className="ml-auto text-sm text-cian-testo hover:underline">Vista tecnica e abbinamenti ›</Link>
      </div>
      {!dati.letto ? (
        <Vuoto titolo="Il centro non si legge" testo={dati.motivo} />
      ) : (
        <>
          {!scrive && <p className="rounded-md border border-dashed p-2 text-[13px]">Si legge ma non si scrive: {dati.scrittura?.motivo}</p>}
          <div className="flex flex-wrap items-center gap-1 border-b">
            {SCHEDE.map((s) => (
              <button key={s.id} type="button" onClick={() => setScheda(s.id)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${scheda === s.id ? "border-[var(--vc-acceso,#0D2537)] font-semibold" : "border-transparent text-muted-foreground"}`}>
                {s.etichetta} <span className="font-mono">{conteggi[s.id]}</span>
              </button>
            ))}
            <Input className="ml-auto h-8 w-64" placeholder="Filtra per nome, IP o modello" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          {selezionati.length > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2">
              <span className="text-sm font-semibold">{selezionati.length} selezionati</span>
              <Button size="sm" variant="outline" disabled={!scrive || !daAggiungere.length} onClick={() => setFinestra({ tipo: "aggiungi", apparati: daAggiungere })}>Aggiungi a Zabbix ({daAggiungere.length})</Button>
              <Button size="sm" variant="outline" disabled={!scrive || !monitorati.length} onClick={() => setFinestra({ tipo: "modelli", cambio: { tipo: "aggiungi", apparati: monitorati } })}>Aggiungi un modello</Button>
              <Button size="sm" variant="outline" disabled={!scrive || !monitorati.length} onClick={() => setFinestra({ tipo: "modelli", cambio: { tipo: "togli", apparati: monitorati } })}>Togli un modello</Button>
              <Button size="sm" variant="outline" disabled={!scrive || !selezionati.some((a) => a.sistema)} onClick={() => setFinestra({ tipo: "agente", apparati: selezionati })}>Prepara l&apos;agente</Button>
              <Button size="sm" variant="ghost" onClick={() => setScelti(new Set())}>Togli la selezione</Button>
              {scelti.size >= MASSIMO_SELEZIONE && <span className="text-[13px] text-muted-foreground">Al massimo {MASSIMO_SELEZIONE} alla volta.</span>}
            </div>
          )}
          {gruppi.length === 0 ? (
            <Vuoto titolo="Nessun apparato" />
          ) : (
            gruppi.map((g) => {
              const tutti = g.lista.every((a) => scelti.has(a.chiave));
              const inZbx = g.lista.filter((a) => a.hostid).length;
              return (
                <Pannello key={g.codice} titolo={g.etichetta} conteggio={g.lista.length} sottotitolo={`${inZbx} in monitoraggio · ${g.lista.length - inZbx} da aggiungere`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[13px] text-muted-foreground">
                          <th className="w-8 pb-1"><input type="checkbox" aria-label={`Scegli tutti: ${g.etichetta}`} checked={tutti} onChange={(e) => scegliGruppo(g.lista, e.target.checked)} /></th>
                          <th className="w-36 pb-1 pr-3 font-normal">Stato</th>
                          <th className="pb-1 pr-3 font-normal">Apparato</th>
                          <th className="w-32 pb-1 pr-3 font-normal">IP</th>
                          <th className="pb-1 pr-3 font-normal">Modelli</th>
                          <th className="w-40 pb-1 pr-3 font-normal">Agente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lista.map((a) => (
                          <tr key={a.chiave} className="border-t align-top">
                            <td className="py-1.5"><input type="checkbox" aria-label={`Scegli ${a.nome}`} checked={scelti.has(a.chiave)} onChange={(e) => scegli(a.chiave, e.target.checked)} /></td>
                            <td className="py-1.5 pr-3"><Badge tono={TONO[a.stato]} testo={TESTO_STATO[a.stato]} /></td>
                            <td className="py-1.5 pr-3">
                              {a.hostIdIpam ? <Link href={`/hosts/${a.hostIdIpam}`} className="font-medium hover:underline">{a.nome}</Link> : <span className="font-medium">{a.nome}</span>}
                              {a.motivo && <span className="block text-[13px] text-muted-foreground">{a.motivo}</span>}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-[13px]">{a.ip ?? "–"}</td>
                            <td className="py-1.5 pr-3">
                              {a.modelli.length ? (
                                <span className="flex flex-wrap gap-1">{a.modelli.map((m) => <span key={m} className="rounded border bg-muted/50 px-1.5 py-0.5 text-[12px]">{m}</span>)}</span>
                              ) : (
                                <span className="text-[13px] text-muted-foreground">{a.hostid ? "nessuno" : "lo propone il centro all'aggiunta"}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3">
                              {AGENTE[a.agente].tono ? <Badge tono={AGENTE[a.agente].tono!} testo={AGENTE[a.agente].testo} /> : <span className="text-[13px] text-muted-foreground">{AGENTE[a.agente].testo}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Pannello>
              );
            })
          )}
        </>
      )}
      {finestra?.tipo === "aggiungi" && <FinestraAggiungi apparati={finestra.apparati} chiudi={() => setFinestra(null)} fatto={dopoScrittura} />}
      {finestra?.tipo === "agente" && <FinestraAgente apparati={finestra.apparati} chiudi={() => setFinestra(null)} />}
      {finestra?.tipo === "modelli" && <FinestraModelli cambio={finestra.cambio} adatti={dati.modelliAdatti ?? null} chiudi={() => setFinestra(null)} fatto={dopoScrittura} />}
    </div>
  );
}
