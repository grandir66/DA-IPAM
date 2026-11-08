"use client";

/**
 * Tab «Porte» dell'hypervisor (Riccardo, 08/11: «gli hypervisor devono essere trattati come switch per le porte»): schede fisiche,
 * bond, bridge e porte delle VM con tipo, VLAN e MAC, dalla Mappa porte (`GET /api/port-map?vista=porte&apparato=`). Non da
 * `switch_ports`, che la Topologia legge: le porte del nodo restano fuori dai suoi collegamenti.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadError } from "@/components/shared/load-error";
import { Vuoto } from "@/components/shared/console";
import { TabellaPorte, type OrdinamentoTabella } from "@/components/mappa-porte/tabella-porte";
import type { SortDirection } from "@/components/shared/sortable-table-head";
import { fetchJson } from "@/lib/fetch-json";
import type { PortaMappa } from "@/lib/mappa-porte/tipi";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import type { Caricamento } from "../router/dati-router";

interface RispostaPorte { righe: PortaMappa[]; totale: number }

export function PorteHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const deviceId = ctx.device?.id;
  const [stato, setStato] = useState<Caricamento<RispostaPorte>>({ fase: "carico" });
  const [n, setN] = useState(0);
  const [ordinaPer, setOrdinaPer] = useState<string | null>(null);
  const [verso, setVerso] = useState<SortDirection>("asc");
  useEffect(() => {
    if (!deviceId) return;
    const ac = new AbortController();
    const ordinamento = ordinaPer ? `&sortBy=${ordinaPer}&sortDir=${verso}` : "";
    fetchJson<RispostaPorte>(`/api/port-map?vista=porte&apparato=${deviceId}${ordinamento}`, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (!ac.signal.aborted) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => ac.abort();
  }, [deviceId, n, ordinaPer, verso]);
  const riprova = useCallback(() => { setStato({ fase: "carico" }); setN((x) => x + 1); }, []);
  const ordine: OrdinamentoTabella = {
    colonna: ordinaPer, verso,
    onOrdina: (c) => { if (c === ordinaPer) setVerso((v) => (v === "asc" ? "desc" : "asc")); else { setOrdinaPer(c); setVerso("asc"); } },
  };
  if (stato.fase === "carico") return <Riquadro titolo="Porte"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;
  if (stato.fase === "errore") return <LoadError what="le porte dell'hypervisor" message={stato.messaggio} onRetry={riprova} />;
  const { righe, totale } = stato.dati;
  if (righe.length === 0) {
    return <Vuoto titolo="Nessuna porta letta" testo="Le porte, la tabella MAC e le VLAN del nodo arrivano dal giro dei parser (lettura «Mappa porte» accesa e credenziale SSH del nodo)." />;
  }
  const altre = totale - righe.length;
  return (
    <Riquadro titolo={`Porte (${totale})`} azione={<Link href="/port-map" className="text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">Mappa porte ›</Link>}>
      <div className="-m-4">
        <TabellaPorte righe={righe} conApparato={false} ordine={ordine} />
      </div>
      {altre > 0 && <p className="mt-6 text-[13px] text-muted-foreground">Altre {altre} porte nella Mappa porte.</p>}
    </Riquadro>
  );
}
