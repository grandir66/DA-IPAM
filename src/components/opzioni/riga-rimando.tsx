"use client";

/**
 * Nelle pagine vecchie, al posto della levetta (oggetto 11 della tavola, spec §3.5): il nome, lo stato ACCESA/SPENTA,
 * «di serie» o «spenta da … il …», e «cambia da Opzioni ›» che porta alla riga giusta. Le levette stanno solo in Opzioni.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { VoceOpzione } from "@/lib/opzioni/tipi";
import { diSerieOCambiata } from "./pagina-opzioni";

/** Le righe chieste, lette da `GET /api/opzioni?ids=…`; `errore` se non si leggono (mai una riga vuota muta). */
export function useVociOpzioni(ids: readonly string[]): { voci: Record<string, VoceOpzione>; errore: string | null; ricarica: () => void } {
  const chiave = ids.join(",");
  const [voci, setVoci] = useState<Record<string, VoceOpzione>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const ricarica = useCallback(async () => {
    const r = await fetchJson<{ opzioni: VoceOpzione[] }>(`/api/opzioni?ids=${encodeURIComponent(chiave)}`, { cache: "no-store" });
    if (r.ok) {
      setVoci(Object.fromEntries(r.data.opzioni.map((v) => [v.id, v])));
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, [chiave]);
  useEffect(() => {
    void ricarica();
  }, [ricarica]);
  return { voci, errore, ricarica: () => void ricarica() };
}

function etichetta(v: VoceOpzione): string {
  if (v.stato.acceso === null) return v.forma === "file" ? "DA FILE" : "DA CONFIGURARE";
  if (v.forma === "modulo") return v.stato.acceso ? "INSTALLATO" : "NON INSTALLATO";
  if (v.forma === "scelta") return (v.scelte?.find((s) => s.valore === v.stato.valore)?.etichetta ?? v.stato.valore ?? "").toUpperCase();
  return v.stato.acceso ? "ACCESA" : "SPENTA";
}

export function RigaRimando({ voce, mostraEsito = true }: { voce: VoceOpzione; mostraEsito?: boolean }) {
  const acceso = voce.stato.acceso === true && voce.forma !== "scelta";
  return (
    <div className="rounded-lg border border-[#D0D8DC] bg-white px-3 py-2 dark:border-[#3A4A57] dark:bg-transparent">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <span className="text-[15px] font-semibold">{voce.nome}</span>
        <span
          className={cn(
            "rounded-full border-2 px-2 py-px text-[13px] font-bold",
            acceso
              ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]"
              : "border-[#5B6B77] bg-white text-[#0D2537] dark:bg-transparent dark:text-[#E6EEF4]",
            voce.stato.acceso === null && "border-dashed",
          )}
        >
          {etichetta(voce)}
        </span>
        <span className="text-[14px]">{diSerieOCambiata(voce)}</span>
        <Link href={`/settings/opzioni#${voce.id}`} className="text-[14px] text-[#006C96] underline hover:text-[#0D2537] dark:text-[#3FBBF0]">
          cambia da Opzioni ›
        </Link>
      </div>
      {mostraEsito && voce.stato.esito.testo && <p className="mt-0.5 text-[14px] font-light">{voce.stato.esito.testo}</p>}
    </div>
  );
}

/** Più righe insieme, nell'ordine dato; se non si leggono, lo dice. */
export function RigheRimando({ ids, mostraEsito = true }: { ids: readonly string[]; mostraEsito?: boolean }) {
  const { voci, errore } = useVociOpzioni(ids);
  if (errore) return <p className="text-[14px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">Stato non leggibile: {errore}</p>;
  return (
    <div className="space-y-2">
      {ids.map((id) => (voci[id] ? <RigaRimando key={id} voce={voci[id]} mostraEsito={mostraEsito} /> : null))}
    </div>
  );
}
