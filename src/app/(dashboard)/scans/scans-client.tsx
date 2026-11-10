"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import {
  IntestazionePagina,
  Pannello,
  VoceSelezionabile,
  Vuoto,
  InCorso,
  Etichetta,
} from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { formatPortsDisplay } from "@/lib/utils";
import { useEAdmin } from "@/hooks/use-e-admin";
import { useGiri } from "@/components/shared/giri-context";
import { etichettaGiro } from "@/lib/scanner/giri";
import {
  FASI_GIRO,
  PRESET_PORTE_GIRO,
  PROFILI_GIRO,
  PROFILI_GIRO_UI,
  SCAN_MODE_GIRO,
  TIPI_GIRO,
  TIPI_GIRO_UI,
  type FaseGiro,
  type PresetPorteGiro,
  type ProfiloGiro,
  type ScanModeGiro,
  type TipoGiro,
} from "@/lib/scanner/profili-giro-ui";
import type { ScanHistory } from "@/types";

interface EsitoLancio {
  avvii: Array<{ network_id: number | null; job_id: string | null; messaggio: string }>;
  saltati: Array<{ network_id: number | null; motivo: string }>;
}

interface Rete {
  id: number;
  name: string;
  cidr: string;
}

interface ReteBersaglio {
  id: number;
  name: string;
  cidr: string;
  vlan_id: number | null;
  servizi: number;
  host: number;
}

const SCANS_LIMIT = 200;
const FASI_UI: Record<FaseGiro, string> = {
  host: "Host (ICMP)",
  porte: "Porte TCP",
  udp: "Porte UDP",
  sonde: "Sonde e identità",
};
const SCAN_MODE_UI: Record<ScanModeGiro, string> = {
  auto: "Automatico (SYN con root, altrimenti connect)",
  syn: "SYN (serve root)",
  connect: "Connect (senza root)",
};
const PRESET_PORTE_UI: Record<PresetPorteGiro, string> = {
  top100: "Top 100 TCP",
  top1000: "Top 1000 TCP",
  all: "Tutte (65.535)",
};
/** Cosa fa ogni profilo, come lo calcola `parametriProfilo`: si mostra in sola lettura. */
const DEL_PROFILO: Record<ProfiloGiro, { tcp: PresetPorteGiro; udp: string; rate: string }> = {
  rapido: { tcp: "top100", udp: "nessuna", rate: "" },
  standard: { tcp: "top1000", udp: "le 20 più comuni", rate: "" },
  completo: { tcp: "all", udp: "le 100 più comuni", rate: "" },
  lento: { tcp: "top1000", udp: "le 20 più comuni", rate: "300" },
  su_misura: { tcp: "top1000", udp: "", rate: "" },
};

/** Numero da una stringa di input: `undefined` se vuota o non valida (così la chiave si omette). */
function numeroOpzionale(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function ScansClient() {
  const admin = useEAdmin();
  const { giri, apri } = useGiri();
  const [tipo, setTipo] = useState<TipoGiro>("discovery");
  const [profilo, setProfilo] = useState<ProfiloGiro>("standard");
  const [fasi, setFasi] = useState<FaseGiro[]>([...FASI_GIRO]);
  const [confermaCompleto, setConfermaCompleto] = useState(false);
  const [proveFabbrica, setProveFabbrica] = useState(false);
  const [reti, setReti] = useState<Rete[]>([]);
  const [scelte, setScelte] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avvio, setAvvio] = useState<string | null>(null);

  // Discovery «Su misura» — parametri avanzati (il motore li accetta dalla v0.9.1079).
  const [targets, setTargets] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [autoTargets, setAutoTargets] = useState(true);
  const [presetPorte, setPresetPorte] = useState<PresetPorteGiro | "custom">("top1000");
  const [tcpCustom, setTcpCustom] = useState("");
  const [udpPorts, setUdpPorts] = useState("");
  const [scanMode, setScanMode] = useState<ScanModeGiro>("auto");
  const [ratePps, setRatePps] = useState("");
  const [retries, setRetries] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [concorrenza, setConcorrenza] = useState("");

  // Segmentazione — sorgente, reti da raggiungere e tecnica di raggiungibilità.
  const [sourceNet, setSourceNet] = useState<number | null>(null);
  const [bersagli, setBersagli] = useState<Set<number>>(new Set());
  const [retiBersaglio, setRetiBersaglio] = useState<ReteBersaglio[]>([]);
  const [tecnica, setTecnica] = useState<"direct" | "icmp_echo">("direct");

  // Sonda L2 — durata dell'ascolto (vuoto = sync immediato).
  const [durataS, setDurataS] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [n, h] = await Promise.all([
      fetchJson<Rete[] | { data: Rete[] }>("/api/networks"),
      fetchJson<ScanHistory[]>(`/api/scans/history?limit=${SCANS_LIMIT}`),
    ]);
    if (n.ok) {
      const grezzo = n.data;
      const lista = Array.isArray(grezzo) ? grezzo : grezzo.data;
      setReti(Array.isArray(lista) ? lista.map((r) => ({ id: r.id, name: r.name, cidr: r.cidr })) : []);
    } else setError(n.message);
    if (h.ok) setHistory(Array.isArray(h.data) ? h.data : []);
    else if (!n.ok) setError(h.message);
    else setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Le reti da raggiungere (coi conteggi) servono solo alla Segmentazione: si leggono quando si sceglie quel tipo.
  useEffect(() => {
    if (tipo !== "segmentazione") return;
    let annullato = false;
    void (async () => {
      const r = await fetchJson<{ reti: ReteBersaglio[] }>("/api/scans/reti-bersaglio");
      if (!annullato && r.ok) setRetiBersaglio(r.data.reti);
    })();
    return () => {
      annullato = true;
    };
  }, [tipo]);

  const serveRete = tipo === "discovery" || tipo === "controlli";
  // Come in Nety: il profilo (quante porte, a che ritmo) è della Discovery. Gli altri tipi lavorano
  // su ciò che è già in inventario: mostrarlo lì faceva credere a una scansione che non parte.
  const haProfilo = tipo === "discovery";
  const suMisura = haProfilo && profilo === "su_misura";
  // Fuori da «Su misura» i campi mostrano ciò che il profilo farà davvero, in sola lettura (come Nety).
  const delProfilo = DEL_PROFILO[profilo];
  const fasiAttive: FaseGiro[] = suMisura ? fasi : FASI_GIRO.filter((f) => f !== "udp" || profilo !== "rapido");
  const controlliAccesi = tipo === "controlli" || fasiAttive.includes("sonde");
  const vuoleTutteLePorte =
    haProfilo && (profilo === "completo" || (profilo === "su_misura" && presetPorte === "all"));

  const motivoBlocco = useMemo(() => {
    if (!admin) return "Solo un amministratore può lanciare un giro";
    if (avvio) return "Un avvio è già in corso";
    if (serveRete && scelte.size === 0) return "Scegli almeno una rete";
    if (tipo === "segmentazione" && sourceNet == null) return "Scegli la rete sorgente";
    if (haProfilo && !autoTargets && targets.trim() === "")
      return "Senza auto-target indica almeno un bersaglio";
    if (vuoleTutteLePorte && !confermaCompleto) return "Tutte le porte: conferma le 65.535 porte TCP";
    return null;
  }, [admin, avvio, serveRete, scelte.size, tipo, sourceNet, haProfilo, autoTargets, targets, vuoleTutteLePorte, confermaCompleto]);

  function corpoLancio(): Record<string, unknown> {
    const b: Record<string, unknown> = { tipo, profilo: haProfilo ? profilo : "standard" };
    if (serveRete) b.network_ids = [...scelte];
    if (haProfilo && profilo === "su_misura") b.fasi = fasi;
    if (tipo === "controlli") {
      const tm = numeroOpzionale(timeoutMs);
      if (tm !== undefined) b.timeout_ms = tm;
      const co = numeroOpzionale(concorrenza);
      if (co !== undefined) b.concorrenza = co;
    }
    if (vuoleTutteLePorte) b.conferma_completo = true;
    if (serveRete && proveFabbrica && controlliAccesi) b.prove_fabbrica = true;

    if (haProfilo) {
      if (targets.trim()) b.targets = targets.trim();
      if (exclusions.trim()) b.exclusions = exclusions.trim();
      b.auto_targets = autoTargets;
    }
    if (suMisura) {
      const tcp = presetPorte === "custom" ? tcpCustom.trim() : presetPorte;
      if (tcp) b.tcp_ports = tcp;
      if (udpPorts.trim()) b.udp_ports = udpPorts.trim();
      b.scan_mode = scanMode;
      const rp = numeroOpzionale(ratePps);
      if (rp !== undefined) b.rate_pps = rp;
      const rt = numeroOpzionale(retries);
      if (rt !== undefined) b.retries = rt;
      const tm = numeroOpzionale(timeoutMs);
      if (tm !== undefined) b.timeout_ms = tm;
      const co = numeroOpzionale(concorrenza);
      if (co !== undefined) b.concorrenza = co;
    }
    if (tipo === "segmentazione") {
      if (sourceNet != null) b.source_network_id = sourceNet;
      if (bersagli.size) b.reti_bersaglio = [...bersagli];
      b.protocollo = tecnica;
    }
    if (tipo === "sonda_l2") {
      const d = numeroOpzionale(durataS);
      if (d !== undefined) b.durata_s = d;
    }
    return b;
  }

  async function avvia() {
    if (motivoBlocco) return;
    setAvvio("Avvio…");
    const r = await fetchJson<EsitoLancio>("/api/scans/lancia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpoLancio()),
    });
    if (!r.ok) {
      toast.error(r.message);
      setAvvio(null);
      return;
    }
    const n = r.data.avvii.length;
    toast.success(n === 1 ? r.data.avvii[0]!.messaggio : `${n} giri avviati`);
    for (const s of r.data.saltati) toast.message(s.motivo);
    // Apre il pannello di avanzamento (ScanProgress, globale) per ogni giro appena avviato.
    for (const a of r.data.avvii) if (a.job_id) apri(a.job_id);
    setAvvio(null);
    void load();
  }

  const giriInCorso = giri.filter((g) => g.status === "running");

  function toggleRete(id: number) {
    setScelte((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleBersaglio(id: number) {
    setBersagli((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const presetConCustom = [...PRESET_PORTE_GIRO, "custom" as const];

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Scansioni di rete"
        sottotitolo="Scegli il tipo, poi la rete. Solo la Discovery cerca porte nuove: gli altri tipi lavorano su ciò che è già in inventario."
        azioni={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/vulnerabilities" />}>
            Vedi i findings
          </Button>
        }
      />

      <div>
        <Pannello numero={1} titolo="Tipo" sottotitolo="Cosa fa questo giro">
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPI_GIRO.map((t) => (
              <VoceSelezionabile key={t} scelta={tipo === t} onScegli={() => setTipo(t)}>
                <p className="font-semibold">{TIPI_GIRO_UI[t].nome}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{TIPI_GIRO_UI[t].riga}</p>
              </VoceSelezionabile>
            ))}
          </div>
        </Pannello>
      </div>

      {serveRete && (
        <Pannello numero={2} titolo="Reti" conteggio={reti.length} sottotitolo="Solo le reti già in inventario">
          {loading ? (
            <p className="p-3 text-[13px] text-muted-foreground">Caricamento…</p>
          ) : reti.length === 0 ? (
            <Vuoto titolo="Nessuna rete" testo="Censisci una subnet, poi torna qui." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {reti.map((r) => (
                <VoceSelezionabile key={r.id} scelta={scelte.has(r.id)} onScegli={() => toggleRete(r.id)}>
                  <p className="font-semibold">{r.name}</p>
                  <p className="font-mono text-[13px] text-muted-foreground">{r.cidr}</p>
                </VoceSelezionabile>
              ))}
            </div>
          )}
        </Pannello>
      )}

      {haProfilo && (
          <Pannello numero={3} titolo="Profilo" sottotitolo="Quante porte e a che ritmo">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {PROFILI_GIRO.map((p) => (
                <VoceSelezionabile
                  key={p}
                  scelta={profilo === p}
                  onScegli={() => {
                    setProfilo(p);
                    if (p !== "completo") setConfermaCompleto(false);
                  }}
                >
                  <p className="font-semibold">{PROFILI_GIRO_UI[p].nome}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{PROFILI_GIRO_UI[p].riga}</p>
                </VoceSelezionabile>
              ))}
            </div>
            {vuoleTutteLePorte && (
              <label className="mt-3 flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confermaCompleto}
                  onChange={(e) => setConfermaCompleto(e.target.checked)}
                />
                <span>Confermo: tutte le 65.535 porte TCP. Non parte dai giri automatici.</span>
              </label>
            )}
          </Pannello>
        )}

      {/* Discovery «Su misura»: targets e parametri (il motore li accetta dalla v0.9.1079). */}
      {haProfilo && (
        <Pannello
          numero={4}
          titolo="Targets e parametri"
          sottotitolo={suMisura ? "Tutti i parametri sono tuoi. Vuoto = valore del motore" : "Porte e ritmo vengono dal profilo. Scegli «Su misura» per cambiarli"}
        >
          <div className="grid gap-3 p-1 lg:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Targets</span>
              <textarea
                value={targets}
                onChange={(e) => setTargets(e.target.value)}
                placeholder="10.0.1.10, 10.0.1.0/28"
                rows={2}
                className="w-full resize-y rounded-lg border bg-card p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="block text-[13px] text-muted-foreground">
                IPv4 o CIDR, separati da spazio o virgola. Devono cadere nelle reti scelte.
              </span>
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Esclusioni</span>
              <textarea
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
                placeholder="10.0.1.1"
                rows={2}
                className="w-full resize-y rounded-lg border bg-card p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="block text-[13px] text-muted-foreground">Mai sondate, in aggiunta a quelle della rete.</span>
            </label>
          </div>
          <label className="mt-1 flex items-start gap-2 p-1 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={autoTargets} onChange={(e) => setAutoTargets(e.target.checked)} />
            <span>Auto-target: aggiunge i prefissi delle reti scelte. Se spento, indica almeno un target.</span>
          </label>

          <div className="grid gap-3 p-1 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Porte TCP</span>
              <select
                value={suMisura ? presetPorte : delProfilo.tcp}
                disabled={!suMisura}
                onChange={(e) => setPresetPorte(e.target.value as PresetPorteGiro | "custom")}
                className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {presetConCustom.map((p) => (
                  <option key={p} value={p}>
                    {p === "custom" ? "Su misura…" : PRESET_PORTE_UI[p]}
                  </option>
                ))}
              </select>
              {suMisura && presetPorte === "custom" && (
                <Input
                  value={tcpCustom}
                  onChange={(e) => setTcpCustom(e.target.value)}
                  placeholder="22,80,8000-8100"
                  className="font-mono"
                />
              )}
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Porte UDP</span>
              <Input value={suMisura ? udpPorts : delProfilo.udp} disabled={!suMisura} onChange={(e) => setUdpPorts(e.target.value)} placeholder="vuoto = niente UDP" className="font-mono" />
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Modo di scansione</span>
              <select
                value={suMisura ? scanMode : "auto"}
                disabled={!suMisura}
                onChange={(e) => setScanMode(e.target.value as ScanModeGiro)}
                className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {SCAN_MODE_GIRO.map((m) => (
                  <option key={m} value={m}>
                    {SCAN_MODE_UI[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Rate (pps)</span>
              <Input value={suMisura ? ratePps : delProfilo.rate} disabled={!suMisura} onChange={(e) => setRatePps(e.target.value)} inputMode="numeric" placeholder="10–10000" className="font-mono" />
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Timeout (ms)</span>
              <Input value={suMisura ? timeoutMs : ""} disabled={!suMisura} onChange={(e) => setTimeoutMs(e.target.value)} inputMode="numeric" placeholder="500–60000" className="font-mono" />
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Concorrenza</span>
              <Input value={suMisura ? concorrenza : ""} disabled={!suMisura} onChange={(e) => setConcorrenza(e.target.value)} inputMode="numeric" placeholder="1–256" className="font-mono" />
            </label>
            <label className="space-y-1">
              <span className="text-[13px] font-medium">Tentativi</span>
              <Input value={suMisura ? retries : ""} disabled={!suMisura} onChange={(e) => setRetries(e.target.value)} inputMode="numeric" placeholder="0–5" className="font-mono" />
            </label>
          </div>
          <fieldset className="mt-2 p-1">
            <legend className="text-[13px] font-medium">Fasi</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-[13px]">
              {FASI_GIRO.map((f) => (
                <label key={f} className={`flex items-center gap-1.5 ${suMisura ? "" : "opacity-70"}`}>
                  <input
                    type="checkbox"
                    disabled={!suMisura}
                    checked={fasiAttive.includes(f)}
                    onChange={() => setFasi((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))}
                  />
                  {FASI_UI[f]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-2 p-1">
            <label className="flex items-start gap-2 rounded-xl border border-[#C9A800] bg-[#FFD400]/10 p-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={proveFabbrica && controlliAccesi}
            disabled={!controlliAccesi}
            onChange={(e) => setProveFabbrica(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-semibold">
              Prove invasive
              <Etichetta tono="ruolo">▲ invasiva</Etichetta>
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Login di fabbrica (FTP, admin/admin, MySQL/MSSQL/Postgres), EternalBlue, IPMI (cipher zero e RAKP), SNMP in scrittura e Jenkins Script Console. Mai nei giri automatici; al massimo 6 tentativi di login per host. Da concordare col cliente.
            </span>
            {!controlliAccesi && <span className="mt-0.5 block">Accendi la fase «Sonde e identità»: le prove invasive fanno parte dei controlli.</span>}
          </span>
        </label>
          </div>
        </Pannello>
      )}

      {tipo === "controlli" && (
        <Pannello numero={3} titolo="Solo controlli" sottotitolo="Lavora sugli host e sui servizi già in inventario per la rete">
          <div className="space-y-3 p-1 text-[13px]">
            <p>
              Non scopre host e non cerca porte: ripassa i servizi già noti e rifà riconoscimento, identità e controlli.
              Dura pochi secondi. Per trovare porte nuove lancia una <strong>Discovery</strong> (Standard = 1000 porte TCP),
              che alla fine fa anche questi controlli.
            </p>
            <p className="text-muted-foreground">
              Rifarlo non duplica niente: aggiorna le righe che ci sono e lascia stati e note come sono.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="font-medium">Timeout (ms)</span>
                <Input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} inputMode="numeric" placeholder="500–60000" className="font-mono" />
              </label>
              <label className="space-y-1">
                <span className="font-medium">Concorrenza</span>
                <Input value={concorrenza} onChange={(e) => setConcorrenza(e.target.value)} inputMode="numeric" placeholder="1–256" className="font-mono" />
              </label>
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-[#C9A800] bg-[#FFD400]/10 p-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={proveFabbrica && controlliAccesi}
            disabled={!controlliAccesi}
            onChange={(e) => setProveFabbrica(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-2 font-semibold">
              Prove invasive
              <Etichetta tono="ruolo">▲ invasiva</Etichetta>
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Login di fabbrica (FTP, admin/admin, MySQL/MSSQL/Postgres), EternalBlue, IPMI (cipher zero e RAKP), SNMP in scrittura e Jenkins Script Console. Mai nei giri automatici; al massimo 6 tentativi di login per host. Da concordare col cliente.
            </span>
            {!controlliAccesi && <span className="mt-0.5 block">Accendi la fase «Sonde e identità»: le prove invasive fanno parte dei controlli.</span>}
          </span>
        </label>
          </div>
        </Pannello>
      )}

      {/* Segmentazione: da quale rete si manda e quali raggiungere, più le tecniche (ancora off). */}
      {tipo === "segmentazione" && (
        <>
          <Pannello numero={2} titolo="Da" sottotitolo="La rete da cui mandi: ogni prova esce da questa interfaccia">
            <div className="grid gap-2 p-1 sm:grid-cols-2 xl:grid-cols-3">
              {reti.map((r) => (
                <VoceSelezionabile key={r.id} scelta={sourceNet === r.id} onScegli={() => setSourceNet(r.id)}>
                  <p className="font-semibold">{r.name}</p>
                  <p className="font-mono text-[13px] text-muted-foreground">{r.cidr}</p>
                </VoceSelezionabile>
              ))}
            </div>
          </Pannello>
          <Pannello
            numero={3}
            titolo="Reti da raggiungere"
            conteggio={retiBersaglio.length}
            sottotitolo="Vuoto = tutte le altre. Rigioca i servizi già noti, nessuna nuova scansione"
          >
            <div className="grid gap-2 p-1 sm:grid-cols-2 xl:grid-cols-3">
              {retiBersaglio
                .filter((r) => r.id !== sourceNet)
                .map((r) => (
                  <VoceSelezionabile key={r.id} scelta={bersagli.has(r.id)} onScegli={() => toggleBersaglio(r.id)}>
                    <p className="font-semibold">
                      {r.name}
                      {r.vlan_id != null && <Etichetta className="ml-2">VLAN {r.vlan_id}</Etichetta>}
                    </p>
                    <p className="font-mono text-[13px] text-muted-foreground">{r.cidr}</p>
                    <p className="text-[13px] text-muted-foreground">{r.servizi} servizi · {r.host} host noti</p>
                  </VoceSelezionabile>
                ))}
            </div>
          </Pannello>
          <Pannello titolo="Come prova la raggiungibilità" sottotitolo="Come la sonda verifica ogni bersaglio. Le altre tecniche di Nety (porta sorgente, IPv6, Layer-2 attivo) la sonda non le fa: qui non compaiono">
            <div className="grid gap-2 p-1 sm:grid-cols-2">
              <VoceSelezionabile scelta={tecnica === "direct"} onScegli={() => setTecnica("direct")}>
                <p className="font-semibold">Connessione TCP diretta</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Prova il servizio noto sulla sua porta (ip:porta). È la prova di default.</p>
              </VoceSelezionabile>
              <VoceSelezionabile scelta={tecnica === "icmp_echo"} onScegli={() => setTecnica("icmp_echo")}>
                <p className="font-semibold">Ping ICMP</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Misura solo se l&apos;host risponde (la porta è ignorata).</p>
              </VoceSelezionabile>
            </div>
          </Pannello>
        </>
      )}

      {/* Sonda L2: durata dell'ascolto. */}
      {tipo === "sonda_l2" && (
        <Pannello titolo="Ascolto" sottotitolo="Passivo: niente scansione. Vuoto = una lettura immediata">
          <label className="flex max-w-xs flex-col gap-1 p-1 text-[13px]">
            <span className="font-medium">Durata (secondi)</span>
            <Input value={durataS} onChange={(e) => setDurataS(e.target.value)} inputMode="numeric" placeholder="1–600 (vuoto = subito)" className="font-mono" />
          </label>
        </Pannello>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!!motivoBlocco} title={motivoBlocco ?? undefined} onClick={() => void avvia()}>
          Avvia {TIPI_GIRO_UI[tipo].nome}
          {haProfilo ? ` · ${PROFILI_GIRO_UI[profilo].nome}` : ""}
        </Button>
        {avvio && <InCorso titolo={avvio} />}
      </div>
      {giriInCorso.length > 0 && (
        <Pannello titolo="Giri in corso" conteggio={giriInCorso.length} sottotitolo="Avanzamento dal vivo; clic su «Apri» per il dettaglio">
          <div className="space-y-2 p-1">
            {giriInCorso.map((g) => {
              const pct = g.total > 0 ? Math.round((g.scanned / g.total) * 100) : null;
              return (
                <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{g.etichetta ?? etichettaGiro(g.scan_type)}</span>
                    <span className="ml-2 text-[13px] text-muted-foreground">{g.phase}</span>
                  </span>
                  {pct != null && <span className="font-mono text-[13px] tabular-nums">{pct}%</span>}
                  <Button size="sm" variant="outline" onClick={() => apri(g.id)}>Apri</Button>
                </div>
              );
            })}
          </div>
        </Pannello>
      )}

      <Pannello titolo="Storico" conteggio={history.length} sottotitolo="Gli ultimi giri di questa installazione">
        {error ? (
          <LoadError what="lo storico" message={error} onRetry={() => void load()} />
        ) : history.length === 0 ? (
          <Vuoto titolo="Nessuna scansione eseguita" testo="Lancia un giro qui sopra." />
        ) : (
          <Table fissa>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Risultato</TableHead>
                <TableHead>Porte aperte</TableHead>
                <TableHead>Durata</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell>
                    <Etichetta>{scan.scan_type}</Etichetta>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{scan.status}</TableCell>
                  <TableCell className="font-mono text-[13px]">{formatPortsDisplay(scan.ports_open)}</TableCell>
                  <TableCell>
                    {scan.duration_ms ? `${(scan.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {parseDbDate(scan.timestamp).toLocaleString("it-IT")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}
