"use client";

/**
 * Dettaglio per apparato dell'ultimo giro di un job `apparati_scelti` (tavola J3): una riga per apparato con lo stato
 * (✓ letto · ▲ parziale · ✕ errore · ● escluso · ● saltato), l'esito di ogni lettura scelta e l'ora del giro in ora
 * italiana. Legge `GET /api/jobs/apparati-scelti/[id]/esiti`; i codici sono quelli scritti dal giro, mai messaggi.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { TESTO_MOTIVO } from "@/lib/apparati-scelti/regole";
import { PastigliaStato } from "./pastiglia-stato";

interface EsitoLettura { stato: string; codice?: string }
interface RigaEsito {
  device_id: number;
  /** L'host dell'apparato: la scheda è /objects/<host_id>; null = apparato senza host o tolto. */
  host_id: number | null;
  nome: string | null;
  stato: "ok" | "parziale" | "errore" | "escluso" | "saltato";
  letture: Record<string, EsitoLettura>;
  motivo: string | null;
}
interface RispostaEsiti { job_id: number; giro_il: string | null; righe: RigaEsito[] }

const STATO: Record<RigaEsito["stato"], { tono: "ok" | "attenzione" | "guasto" | "da_verificare"; testo: string }> = {
  ok: { tono: "ok", testo: "letto" },
  parziale: { tono: "attenzione", testo: "parziale" },
  errore: { tono: "guasto", testo: "errore" },
  escluso: { tono: "da_verificare", testo: "escluso" },
  saltato: { tono: "da_verificare", testo: "saltato" },
};

/** Il motivo scritto dal giro in parole: quelli d'esclusione da `regole.ts`, i salti qui; un codice di trasporto resta com'è. */
const MOTIVO_GIRO: Record<string, string> = {
  ...TESTO_MOTIVO,
  OCCUPATO: "già in lettura, saltato",
  NIENTE_DA_LEGGERE: "niente da leggere",
};

const NOME_LETTURA: Record<string, string> = { info: "Informazioni", porte_mac: "Porte e MAC", vlan: "VLAN" };

/** Segno + parola + codice di una lettura: ✓ letta · ✕ in errore · – spenta o non valida. */
function testoLettura(e: EsitoLettura): string {
  if (e.stato === "letto") return "✓";
  if (e.stato === "errore") return `✕${e.codice ? ` ${e.codice}` : ""}`;
  return `– ${e.stato === "spenta" ? "spenta" : "non vale"}`;
}

const ora = (iso: string): string =>
  parseDbDate(iso).toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function EsitiApparatiScelti({ jobId }: { jobId: number }) {
  const [dati, setDati] = useState<RispostaEsiti | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<RispostaEsiti>(`/api/jobs/apparati-scelti/${jobId}/esiti`);
    if (r.ok) setDati(r.data); else setErrore(r.message);
  }, [jobId]);

  useEffect(() => { void carica(); }, [carica]);

  if (errore) return <LoadError what="gli esiti per apparato" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="px-2 py-3 text-sm text-muted-foreground">Caricamento…</p>;
  if (dati.righe.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">Il job non è ancora girato.</p>;

  return (
    <div className="space-y-2 px-2 py-3" data-testid={`esiti-job-${jobId}`}>
      {dati.giro_il && <p className="text-[13px] text-muted-foreground">Ultimo giro: {ora(dati.giro_il)}</p>}
      <ul className="divide-y rounded-md border bg-background">
        {dati.righe.map((r) => (
          <li key={r.device_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-[10rem] font-medium">
              {r.nome && r.host_id != null
                ? <Link href={`/objects/${r.host_id}`} className="underline-offset-2 hover:underline">{r.nome}</Link>
                : r.nome ?? `apparato #${r.device_id} (tolto)`}
            </span>
            <PastigliaStato tono={STATO[r.stato].tono}>{STATO[r.stato].testo}</PastigliaStato>
            {Object.entries(r.letture).map(([k, e]) => (
              <span key={k} className="text-[13px] text-muted-foreground">{NOME_LETTURA[k] ?? k} {testoLettura(e)}</span>
            ))}
            {r.motivo && <span className="text-[13px] text-muted-foreground" title={r.motivo}>{MOTIVO_GIRO[r.motivo] ?? r.motivo}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
