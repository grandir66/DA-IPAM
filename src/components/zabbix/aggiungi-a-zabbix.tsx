"use client";

/**
 * «Aggiungi a Zabbix»: più apparati insieme (13/11/2026, tappa C di DATIA MONITORING).
 *
 * Prima **Prova** sui selezionati: il centro dice per ognuno cosa farebbe, senza scrivere.
 * Poi **Aggiungi**, solo per quelli che il centro accetta. Uno alla volta, perché il centro
 * ne accetta dieci al minuto: se dice «aspetta», si aspetta il tempo che dice e si riprende.
 * Per Windows e Linux l'esito porta lo script dell'agente, da lanciare a mano.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { Dialog, DialogContent, DialogHeader, DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS } from "@/components/ui/dialog";
import { Script } from "@/components/zabbix/metti-in-monitoraggio";
import { getClassificationLabel } from "@/lib/device-classifications";
import { fetchJson } from "@/lib/fetch-json";
import type { EsitoScrittura } from "@/lib/zabbix-lettura/scrittura";

interface Candidato {
  id: number;
  ip: string;
  nome: string;
  classificazione: string | null;
  stato: string | null;
}

type Riga = { tipo: "attesa" } | { tipo: "esito"; esito: EsitoScrittura } | { tipo: "errore"; testo: string };

const MASSIMO_SELEZIONE = 50;

function testoEsito(r: Riga | undefined): string {
  if (!r) return "";
  if (r.tipo === "attesa") return "…";
  if (r.tipo === "errore") return r.testo;
  const e = r.esito;
  switch (e.esito) {
    case "prova": return e.farebbe === "serve_agente" ? `Entra con ${e.template.filter((t) => t !== "ICMP Ping")[0] ?? "ping"}, poi serve l'agente` : `Entra con ${e.template.filter((t) => t !== "ICMP Ping")[0] ?? "solo ping"}`;
    case "fuori_perimetro": return `Fuori perimetro: ${e.motivo}`;
    case "inserito": return "Aggiunto";
    case "gia_presente": return "C'era già";
    case "serve_agente": return "Aggiunto, manca l'agente";
  }
}

async function chiamaConAttesa(id: number, prova: boolean): Promise<Riga> {
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const r = await fetchJson<EsitoScrittura>(`/api/hosts/${id}/zabbix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prova }),
    });
    if (r.ok) return { tipo: "esito", esito: r.data };
    // Il centro ne accetta dieci al minuto: si aspetta e si riprova, mai all'infinito.
    if (/troppe richieste|aspetta/i.test(r.message)) {
      await new Promise((ok) => setTimeout(ok, 7000));
      continue;
    }
    return { tipo: "errore", testo: r.message };
  }
  return { tipo: "errore", testo: "Il centro chiede di aspettare: riprova fra un minuto" };
}

export function AggiungiAZabbix() {
  const [dati, setDati] = useState<{ possibile: boolean; motivo?: string; candidati: Candidato[] } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [righe, setRighe] = useState<Map<number, Riga>>(new Map());
  const [lavoro, setLavoro] = useState<"prova" | "aggiungi" | null>(null);
  const [script, setScript] = useState<Extract<EsitoScrittura, { esito: "serve_agente" }> | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<{ possibile: boolean; motivo?: string; candidati: Candidato[] }>("/api/zabbix/candidati", { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, []);
  useEffect(() => { void carica(); }, [carica]);

  const visibili = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const tutti = dati?.candidati ?? [];
    if (!f) return tutti;
    return tutti.filter((c) => `${c.nome} ${c.ip} ${c.classificazione ? getClassificationLabel(c.classificazione) : ""}`.toLowerCase().includes(f));
  }, [dati, filtro]);

  function scegli(id: number, si: boolean) {
    setScelti((prima) => {
      const n = new Set(prima);
      if (si && n.size < MASSIMO_SELEZIONE) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function giro(prova: boolean) {
    // Si aggiunge solo ciò che la prova ha detto di sì: mai alla cieca.
    const ids = [...scelti].filter((id) => {
      if (prova) return true;
      const r = righe.get(id);
      return r?.tipo === "esito" && r.esito.esito === "prova";
    });
    setLavoro(prova ? "prova" : "aggiungi");
    for (const id of ids) {
      setRighe((m) => new Map(m).set(id, { tipo: "attesa" }));
      const r = await chiamaConAttesa(id, prova);
      setRighe((m) => new Map(m).set(id, r));
    }
    setLavoro(null);
    if (!prova) void carica();
  }

  const pronti = [...scelti].filter((id) => { const r = righe.get(id); return r?.tipo === "esito" && r.esito.esito === "prova"; }).length;

  if (errore) return <LoadError what="gli apparati da aggiungere" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Carico…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/zabbix" className="text-sm text-cian-testo hover:underline">← Zabbix</Link>
        <h1 className="text-2xl font-bold tracking-tight">Aggiungi a Zabbix</h1>
        <p className="text-[13px] text-muted-foreground">Gli apparati non ancora abbinati. Prima la prova, poi l&apos;aggiunta: il centro decide modello e perimetro.</p>
      </div>
      {!dati.possibile ? (
        <Vuoto titolo="Non si può aggiungere da qui" testo={dati.motivo} />
      ) : (
        <Pannello
          titolo="Apparati non abbinati"
          conteggio={dati.candidati.length}
          azioni={
            <>
              <Input className="h-8 w-56" placeholder="Filtra per nome, IP o tipo" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!scelti.size || lavoro !== null} onClick={() => void giro(true)}>
                {lavoro === "prova" && <Loader2 className="mr-1 size-4 animate-spin" />}Prova ({scelti.size})
              </Button>
              <Button size="sm" disabled={!pronti || lavoro !== null} onClick={() => void giro(false)}>
                {lavoro === "aggiungi" && <Loader2 className="mr-1 size-4 animate-spin" />}Aggiungi ({pronti})
              </Button>
            </>
          }
        >
          {visibili.length === 0 ? (
            <Vuoto titolo="Nessun apparato da aggiungere" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-muted-foreground">
                    <th className="w-8 pb-1" />
                    <th className="pb-1 pr-3 font-normal">Apparato</th>
                    <th className="pb-1 pr-3 font-normal">IP</th>
                    <th className="pb-1 pr-3 font-normal">Tipo</th>
                    <th className="pb-1 pr-3 font-normal">Stato</th>
                    <th className="pb-1 pr-3 font-normal">Cosa dice il centro</th>
                  </tr>
                </thead>
                <tbody>
                  {visibili.map((c) => {
                    const r = righe.get(c.id);
                    const conScript = r?.tipo === "esito" && r.esito.esito === "serve_agente" ? r.esito : null;
                    return (
                      <tr key={c.id} className="border-t align-top">
                        <td className="py-1.5">
                          <input type="checkbox" aria-label={`Scegli ${c.nome}`} checked={scelti.has(c.id)} disabled={lavoro !== null} onChange={(e) => scegli(c.id, e.target.checked)} />
                        </td>
                        <td className="py-1.5 pr-3 font-medium"><Link href={`/hosts/${c.id}`} className="hover:underline">{c.nome}</Link></td>
                        <td className="py-1.5 pr-3 font-mono text-[13px]">{c.ip}</td>
                        <td className="py-1.5 pr-3">{c.classificazione ? getClassificationLabel(c.classificazione) : "–"}</td>
                        <td className="py-1.5 pr-3">{c.stato === "online" ? "acceso" : c.stato === "offline" ? "spento" : "non so"}</td>
                        <td className="py-1.5 pr-3 text-[13px]">
                          {testoEsito(r)}
                          {conScript && (
                            <Button size="sm" variant="link" className="ml-1 h-auto p-0" onClick={() => setScript(conScript)}>script ›</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {scelti.size >= MASSIMO_SELEZIONE && <p className="mt-2 text-[13px] text-muted-foreground">Al massimo {MASSIMO_SELEZIONE} alla volta.</p>}
            </div>
          )}
        </Pannello>
      )}
      <Dialog open={script !== null} onOpenChange={(o) => { if (!o) setScript(null); }}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle className="text-lg">Agente per {script?.host}</DialogTitle>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">{script && <Script e={script} />}</DialogScrollableArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
