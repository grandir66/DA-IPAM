"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { conLibrenms } from "@/lib/scheda/librenms-vista";
import type { ContestoScheda } from "./contesto";
import { oraBreve, PastigliaAggiunta, statoAggiunta } from "./librenms-pezzi";
import type { StatoAggiuntaLibrenms } from "@/lib/integrations/librenms-fonte";

/** Da dove vengono i dati. `nota` sostituisce il testo di default dell'esito («nessun agente», «non abbinato»…). */
export type Fonte = { nome: string; esito: "ok" | "assente" | "non_abbinato"; quando?: string; nota?: string };

/**
 * Riga delle fonti, in fondo alla Panoramica: una fonte mancante si dice qui, una volta, al posto
 * delle card vuote piene di «—». Il segno accompagna sempre la parola (✓ ● –).
 */
export function RigaFonti({ fonti }: { fonti: Fonte[] }) {
  if (fonti.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="font-semibold">Dati da:</span>
      {fonti.map((f) => (
        <span key={f.nome} className={cn(f.esito === "ok" && "text-foreground")}>
          <span aria-hidden>{f.esito === "ok" ? "✓" : f.esito === "non_abbinato" ? "●" : "–"} </span>
          {f.nome}
          {f.esito === "ok" ? (f.quando ? ` ${f.quando}` : "") : `: ${f.nota ?? (f.esito === "non_abbinato" ? "non abbinato" : "nessun dato")}`}
        </span>
      ))}
    </p>
  );
}

/**
 * La riga delle fonti della Panoramica con la voce di LibreNMS dalle tabelle `librenms_*` (L4), se la sua lettura è accesa.
 * Oggetto non in LibreNMS: «Aggiungi a LibreNMS» accanto (solo admin), la stessa rotta della Discovery, senza `force_add`:
 * un rifiuto dice il motivo di LibreNMS (22/10: sulla scheda degli hypervisor non c'era modo di aggiungerlo).
 */
export function RigaFontiScheda({ ctx, fonti }: { ctx: ContestoScheda; fonti: Fonte[] }) {
  const [inCorso, setInCorso] = useState(false);
  // Lo stato dopo un «Non aggiungere» / «Togli l'esclusione» (la rotta lo restituisce): vince su quello caricato con la scheda.
  const [aggiuntaNuova, setAggiuntaNuova] = useState<StatoAggiuntaLibrenms | null | undefined>(undefined);
  const d = ctx.librenmsDati;
  const puoAggiungere = ctx.isAdmin && !!d?.acceso && !d.abbinato;
  const aggiunta = d?.acceso && !d.abbinato ? (aggiuntaNuova !== undefined ? aggiuntaNuova : d.aggiunta) : null;
  const esclusione = async (escludi: boolean) => {
    setInCorso(true);
    try {
      const r = await fetch(`/api/hosts/${ctx.hostId}/librenms/esclusione`, { method: escludi ? "POST" : "DELETE" });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; aggiunta?: StatoAggiuntaLibrenms | null };
      if (r.ok) {
        setAggiuntaNuova(corpo.aggiunta ?? null);
        toast.success(escludi ? "Escluso: il giro automatico non lo aggiunge a LibreNMS." : "Esclusione tolta: torna fra i candidati di LibreNMS.");
      } else toast.error(corpo.error ?? `Errore ${r.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setInCorso(false);
    }
  };
  const aggiungi = async () => {
    setInCorso(true);
    try {
      const r = await fetch("/api/integrations/librenms/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: ctx.hostId }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) toast.success("Aggiunto a LibreNMS: i suoi dati arrivano con la prossima lettura.");
      else toast.error(`LibreNMS non l'ha aggiunto: ${corpo.error ?? `errore ${r.status}`}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setInCorso(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* Con la pastiglia dell'aggiunta la voce «LibreNMS: non abbinato» direbbe la stessa cosa due volte. */}
      <RigaFonti fonti={conLibrenms(fonti, d, oraBreve).filter((f) => !(statoAggiunta(aggiunta) && f.nome === "LibreNMS" && f.esito === "non_abbinato"))} />
      <PastigliaAggiunta a={aggiunta} />
      {puoAggiungere && (
        <Button variant="outline" size="sm" disabled={inCorso} onClick={() => void aggiungi()}>
          {inCorso ? "Aggiunta in corso…" : "Aggiungi a LibreNMS"}
        </Button>
      )}
      {/* L'esclusione ferma solo il giro automatico: «Aggiungi a LibreNMS» resta accanto (tavola 2026-10-23, oggetti 2 e 5). */}
      {puoAggiungere && aggiunta?.esclusioni && (
        <Button variant="outline" size="sm" disabled={inCorso} onClick={() => void esclusione(!aggiunta.escluso_il)}>
          {aggiunta.escluso_il ? "Togli l'esclusione" : "Non aggiungere a LibreNMS"}
        </Button>
      )}
    </div>
  );
}
