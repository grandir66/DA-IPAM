"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";
import { ETICHETTA_OPZIONE } from "@/lib/modules/offerta";
import { rigaModulo, type RigaModulo, type StatoRiga } from "@/lib/modules/elenco-righe";

/**
 * Elenco dei moduli (analisi del 19/10, F10, approvato da Riccardo): una riga per
 * modulo con nome, opzione, stato e «Apri» verso la sua pagina. Configurazione,
 * test e verifiche stanno nella pagina del modulo, non più tutti qui insieme.
 */

interface ModuloApi {
  key: string;
  label: string;
  offerta: "base" | "opzione";
  installed: boolean;
  configured: boolean;
  enabled: boolean;
  configHref: string;
  note?: string;
}
interface SaluteApi {
  key: string;
  verdict: string;
  detail: string | null;
}

/** Stato a doppio segnale (fondo e bordo) e un simbolo: si distingue anche senza colori. */
const STILE: Record<StatoRiga, { testo: string; segno: string; classi: string }> = {
  guasto: { testo: "Guasto", segno: "✕", classi: "bg-red-700 text-white border-red-900" },
  attenzione: { testo: "Attenzione", segno: "!", classi: "bg-amber-100 text-amber-950 border-amber-600" },
  acceso: { testo: "Acceso", segno: "✓", classi: "bg-green-800 text-white border-green-950" },
  da_verificare: { testo: "Da verificare", segno: "?", classi: "bg-white text-slate-800 border-slate-500 dark:bg-slate-900 dark:text-slate-100" },
  spento: { testo: "Spento", segno: "–", classi: "bg-transparent text-muted-foreground border-dashed border-slate-400" },
};

export function ElencoModuli() {
  const [righe, setRighe] = useState<RigaModulo[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    const [m, h] = await Promise.all([
      fetchJson<{ modules?: ModuloApi[]; pannelli?: { zabbix?: boolean } }>("/api/modules", { cache: "no-store" }),
      fetchJson<{ health?: SaluteApi[] }>("/api/modules/health", { cache: "no-store" }),
    ]);
    if (!m.ok) {
      setErrore(m.message);
      return;
    }
    // La salute è un'aggiunta: se non si legge, le righe lo dicono («da verificare»), non spariscono.
    const salute = new Map((h.ok ? h.data.health ?? [] : []).map((x) => [x.key, x]));
    const moduli = (m.data.modules ?? []).map((x) => rigaModulo(x, salute.get(x.key) ?? null));
    const extra: RigaModulo[] = [
      rigaModulo({ key: "zabbix", label: "Zabbix — pannello in sola lettura", offerta: "opzione", enabled: m.data.pannelli?.zabbix === true, configHref: "" }, null),
      rigaModulo({ key: "loki", label: "Grafana Loki", offerta: "base", enabled: false, configHref: "" }, null, "Integrazione secondaria: si installa dalla sua pagina."),
      rigaModulo({ key: "credenziali", label: "Credenziali di sistema", offerta: "base", enabled: true, configHref: "" }, null, "Le credenziali condivise dalle integrazioni."),
    ];
    setRighe([...moduli, ...extra]);
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  if (errore) return <LoadError what="l'elenco dei moduli" message={errore} onRetry={() => void carica()} />;
  if (!righe) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento…
      </div>
    );
  }

  return (
    <div className="rounded-lg border divide-y bg-card">
      {righe.map((r) => {
        const st = STILE[r.stato];
        // Loki e le credenziali di sistema non hanno un interruttore: niente stato inventato.
        const senzaStato = r.key === "loki" || r.key === "credenziali";
        return (
          <div key={r.key} className="flex items-center gap-4 px-4 py-3 text-[13px]">
            <div className="w-72 shrink-0 font-medium flex items-center gap-2">
              {r.label}
              {r.opzione && (
                <span className="rounded border border-slate-400 px-1.5 py-0.5 text-[12px] font-normal text-muted-foreground" title="Modulo opzionale, potenzialmente a pagamento">
                  {ETICHETTA_OPZIONE}
                </span>
              )}
            </div>
            {senzaStato ? (
              <span className="w-36 shrink-0" />
            ) : (
              <span className={`inline-flex w-36 shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${st.classi}`}>
                <span aria-hidden className="font-bold">{st.segno}</span>
                {st.testo}
              </span>
            )}
            <span className="flex-1 text-muted-foreground truncate" title={r.dettaglio ?? undefined}>
              {r.dettaglio ?? ""}
            </span>
            {r.href ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={r.href} />}>
                Apri
              </Button>
            ) : (
              <span className="w-[52px]" />
            )}
          </div>
        );
      })}
    </div>
  );
}
