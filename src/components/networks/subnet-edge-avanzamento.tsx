"use client";

/**
 * Avanzamento per IP e host lenti nel pannello VA Scan di una rete (06/11/2026, piano host lenti).
 * Tavola approvata da Riccardo il 06/11: stati sempre con segno e parola, testo da 13 px.
 *
 * - `useAvanzamento`, `useHostLenti`: leggono ogni 30 secondi, solo a pannello aperto;
 * - `AvanzamentoScansione`: compare solo se la rete ha una scansione aperta;
 * - `BloccoHostLenti`: con host lenti sta sotto l'avanzamento, senza resta il solo interruttore in fondo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Barra, RigaMessaggio } from "@/components/networks/subnet-edge-finestra";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { oraItaliana } from "@/lib/vuln/finestra";
import { daQuanto, percentoBarra, testoDurata, type AvanzamentoRete, type RispostaHostLenti } from "@/lib/vuln/avanzamento";
import type { StatoHostLenti } from "@/lib/vuln/edge-subnet-bridge";

const OGNI_MS = 30_000;
const NOTA = "text-[13px] text-muted-foreground";
const SONDA_VECCHIA = "Sonda da aggiornare: l'avanzamento per IP arriva dopo l'aggiornamento.";

type StatoAvanzamento = AvanzamentoRete | { stato: "nessuna" };

interface Lettura<T> {
  dati: T | null;
  errore: string | null;
  rileggi: () => Promise<void>;
  sostituisci: (d: T) => void;
}

/** Stessa disciplina di `useFinestra`: una risposta vecchia non copre una nuova, una lettura fallita si dice. */
function useLettura<T>(url: string, attivo: boolean): Lettura<T> {
  const [dati, setDati] = useState<T | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const richiesta = useRef<AbortController | null>(null);

  const rileggi = useCallback(async () => {
    richiesta.current?.abort();
    const ac = new AbortController();
    richiesta.current = ac;
    try {
      const res = await fetchJson<T>(url, { signal: ac.signal });
      if (ac.signal.aborted) return;
      if (res.ok) {
        setDati(res.data);
        setErrore(null);
      } else {
        setErrore(res.message);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      if (!ac.signal.aborted) setErrore(e instanceof Error ? e.message : "Lettura non riuscita");
    }
  }, [url]);

  useEffect(() => {
    if (!attivo) return;
    void rileggi();
    const giro = setInterval(() => void rileggi(), OGNI_MS);
    return () => {
      clearInterval(giro);
      richiesta.current?.abort();
    };
  }, [attivo, rileggi]);

  return { dati, errore, rileggi, sostituisci: setDati };
}

export const useAvanzamento = (networkId: number, attivo: boolean) =>
  useLettura<StatoAvanzamento>(`/api/networks/${networkId}/edge-scan/avanzamento`, attivo);

export const useHostLenti = (networkId: number, attivo: boolean) =>
  useLettura<StatoHostLenti>(`/api/networks/${networkId}/edge-scan/host-lenti`, attivo);

function Conto({ segno, nome, n, classi }: { segno: string; nome: string; n: number; classi: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-[13px]", classi)}>
      <span><span aria-hidden>{segno}</span> {nome}</span>
      <b className="font-mono text-xl font-bold leading-tight tabular-nums">{n}</b>
    </div>
  );
}

function ElencoIp({ segno, titolo, ip }: { segno: string; titolo: string; ip: string[] }) {
  if (ip.length === 0) return null;
  return (
    <div>
      <p className="text-[13px] font-semibold"><span aria-hidden>{segno}</span> {titolo} ({ip.length})</p>
      <p className="font-mono text-[13px] leading-relaxed break-words">{ip.join(" · ")}</p>
    </div>
  );
}

export function AvanzamentoScansione({ lettura }: { lettura: Lettura<StatoAvanzamento> }) {
  const d = lettura.dati;
  if (lettura.errore && (d === null || d.stato !== "ok")) {
    return <RigaMessaggio riga={{ tono: "guasto", testo: `✕ Avanzamento non letto: ${lettura.errore}` }} />;
  }
  if (d === null || d.stato === "nessuna") return null;
  if (d.stato === "da_aggiornare") return <RigaMessaggio riga={{ tono: "neutro", testo: `● ${SONDA_VECCHIA}` }} />;
  if (d.stato === "sonda_assente" || d.stato === "errore") {
    return <RigaMessaggio riga={{ tono: "guasto", testo: `✕ Avanzamento non letto: ${d.messaggio}` }} />;
  }

  const percento = percentoBarra(d);
  const adesso = new Date();
  return (
    <section className="space-y-3 rounded-xl border bg-card p-3.5" aria-label="Avanzamento della scansione">
      <div>
        <p className="text-sm font-semibold">
          Scansione in corso · partita alle {oraItaliana(d.partita_at)} · {percento}%
          {d.percento === null && <span className={cn(NOTA, "ml-2 font-normal")}>percentuale di Greenbone non ancora nota</span>}
        </p>
        <Barra percento={percento} etichetta={`${percento} per cento`} alta colore="bg-[var(--host-online)]" />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Conto segno="✓" nome="Fatti" n={d.finiti} classi={STILE_STATO.ok.classi} />
        <Conto segno="▶" nome="In analisi" n={d.in_analisi.length} classi="border-cian-testo bg-selezione text-cian-testo" />
        <Conto segno="○" nome="Da fare" n={d.da_fare.length} classi="border-muted-foreground bg-muted text-foreground" />
        <Conto segno="◐" nome="Lenti" n={d.lenti.length} classi="border-foreground/50 bg-warning/20 text-foreground" />
      </div>

      {d.in_analisi.length > 0 && (
        <div>
          <p className="text-[13px] font-semibold"><span aria-hidden>▶</span> In analisi</p>
          <ul className="text-sm">
            {d.in_analisi.map((h) => (
              <li key={h.ip} className="flex gap-3">
                <span className="font-mono">{h.ip}</span>
                <span className="text-muted-foreground">{daQuanto(h.da, adesso)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(d.da_fare.length > 0 || d.fatti.length > 0) && (
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold">Elenco degli IP</summary>
          <div className="mt-2 space-y-2">
            <ElencoIp segno="○" titolo="Da fare" ip={d.da_fare} />
            <ElencoIp segno="✓" titolo="Fatti" ip={d.fatti} />
          </div>
        </details>
      )}

      {lettura.errore && <RigaMessaggio riga={{ tono: "guasto", testo: `✕ Ultimo aggiornamento non riuscito: ${lettura.errore}` }} />}
    </section>
  );
}

/** Lo stesso blocco per una rete della pagina Scansioni VA: un componente per rete, perché legge da sé. */
export function AvanzamentoDellaRete({ networkId, nome, cidr }: { networkId: number; nome: string; cidr: string }) {
  const lettura = useAvanzamento(networkId, true);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">{nome} <span className="font-mono font-normal text-muted-foreground">{cidr}</span></p>
      <AvanzamentoScansione lettura={lettura} />
    </div>
  );
}

export function BloccoHostLenti({ networkId, lettura, posto }: { networkId: number; lettura: Lettura<StatoHostLenti>; posto: "sopra" | "fondo" }) {
  const [salvando, setSalvando] = useState(false);
  const d = lettura.dati;

  const salva = async (corpo: { escludi_lenti?: boolean; job_lenti?: boolean; togli_ip?: string }) => {
    setSalvando(true);
    try {
      const res = await fetchJson<RispostaHostLenti>(`/api/networks/${networkId}/edge-scan/host-lenti`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (res.ok) lettura.sostituisci({ stato: "ok", ...res.data });
      else toast.error(res.message);
    } finally {
      setSalvando(false);
    }
  };

  // I guasti li dice una volta sola il blocco in fondo; sonda vecchia e rete nuova non hanno niente da mostrare.
  if (d === null || d.stato !== "ok") {
    if (posto === "sopra" || !lettura.errore && !(d && (d.stato === "errore"))) return null;
    const motivo = d && d.stato === "errore" ? d.messaggio : lettura.errore;
    return <RigaMessaggio riga={{ tono: "guasto", testo: `✕ Host lenti non letti: ${motivo}` }} />;
  }

  const conHost = d.host.length > 0;
  if (conHost !== (posto === "sopra")) return null;

  const interruttore = (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5">
        <Switch
          id={`escludi-lenti-${networkId}`}
          checked={d.escludi_lenti}
          disabled={salvando}
          onCheckedChange={(v) => void salva({ escludi_lenti: v })}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor={`escludi-lenti-${networkId}`} className="text-sm">Escludi gli host lenti dalla scansione principale</Label>
          <p className={NOTA}>
            {d.job_lenti ? "Vanno subito nel job separato, dopo le altre scansioni della sonda." : "Restano fuori dalla scansione finché non li riporti."}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <Switch
          id={`job-lenti-${networkId}`}
          checked={d.job_lenti}
          disabled={salvando}
          onCheckedChange={(v) => void salva({ job_lenti: v })}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor={`job-lenti-${networkId}`} className="text-sm">Riscansiona gli host lenti in un job separato</Label>
          <p className={NOTA}>Spento di serie. Da non accendere sulle reti con impianti: un host lento può essere un PLC in difficoltà.</p>
        </div>
      </div>
    </div>
  );

  if (!conHost) return interruttore;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-3.5" aria-label="Host lenti di questa rete">
      <p className="text-sm font-semibold"><span aria-hidden>◐</span> Host lenti di questa rete</p>
      <ul className="space-y-1.5 text-sm">
        {d.host.map((h) => (
          <li key={h.ip} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono">{h.ip}</span>
            <span className="text-muted-foreground">ultima durata {testoDurata(h.durata_s)}</span>
            <span className="text-muted-foreground">visto {h.volte} {h.volte === 1 ? "volta" : "volte"}</span>
            <Button type="button" variant="outline" size="sm" className="min-h-8" disabled={salvando} onClick={() => void salva({ togli_ip: h.ip })}>
              Riporta nella scansione
            </Button>
          </li>
        ))}
      </ul>
      {interruttore}
    </section>
  );
}
