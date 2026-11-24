"use client";

/**
 * Il riquadro di ciò che si è cliccato nella tavola (Riccardo, 24/11): fisso in basso a destra, così si vede ovunque si sia
 * e non sposta la tavola. Di un collegamento dice i due capi, che sono pulsanti e portano alla porta; di una porta, quello
 * che l'apparato ha detto di lei. Sola lettura.
 */
import Link from "next/link";
import { LocateFixed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MapLink } from "@/lib/topology/model-types";
import { SOURCE_WORDS, seenWords, speedLabel } from "@/lib/topology/edge-look";
import type { ApparatoComposto, PortaComposta } from "@/lib/topology/tavola/tipi";
import { NOME_TIPO } from "./stile-tavola";

const STATO = { up: "accesa", down: "spenta", disabled: "disabilitata" } as const;

function RigheDiPorta({ porta, apparato }: { porta: PortaComposta; apparato: ApparatoComposto }) {
  const l = porta.letta;
  const voci: Array<[string, string | null]> = [
    ["Tipo", NOME_TIPO[porta.tipo]],
    ["Stato", l?.stato ? STATO[l.stato] : null],
    ["Velocità", l?.velocita ?? null],
    ["VLAN", porta.vlan !== null ? String(porta.vlan) : null],
    ["Chi c'è", l ? [l.nomeClient, l.ipClient].filter(Boolean).join(" · ") || null : null],
    ["MAC visti", l && l.macCount > 0 ? String(l.macCount) : null],
    ["PoE", l?.poeW != null ? `${l.poeW} W` : null],
    ["Va a", porta.destinazione],
  ];
  return (
    <div className="space-y-1">
      <p className="font-semibold">{apparato.nome} <span className="font-mono">{porta.nome}</span></p>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2">
        {voci.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {porta.fantasma && <p>Porta non nell&apos;elenco dell&apos;apparato.</p>}
    </div>
  );
}

export function RiquadroScelta(p: {
  collegamento: MapLink | null;
  porta: PortaComposta | null;
  apparati: readonly ApparatoComposto[];
  nomeDi: (id: string) => string;
  onVai: (portaId: string) => void;
  onChiudi: () => void;
}) {
  const { collegamento: c, porta } = p;
  const apparato = porta ? p.apparati.find((a) => a.nodo === porta.nodo) ?? null : null;
  if (!c && !(porta && apparato)) return null;
  const capi = c ? [{ nodo: c.a, nome: c.aPort }, { nodo: c.b, nome: c.bPort }] : [];
  return (
    <section aria-label={c ? "Collegamento" : "Porta"}
      className="fixed bottom-20 right-4 z-20 max-h-[38vh] w-[26rem] overflow-y-auto rounded-xl border-2 border-primary bg-card px-4 py-3 text-[13px] shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{c ? "Collegamento" : "Porta"}</h2>
        <Button variant="ghost" size="sm" onClick={p.onChiudi} aria-label="Chiudi"><X className="h-4 w-4" /></Button>
      </div>
      {c && (
        <div className="space-y-2">
          {capi.map((x, i) => {
            const dove = p.apparati.find((a) => a.nodo === x.nodo)?.porte.filter((q) => q.collegamento === c.id) ?? [];
            const testo = <span className="min-w-0 truncate">{p.nomeDi(x.nodo)} <span className="font-mono">{x.nome || "?"}</span></span>;
            return dove.length > 0 ? (
              <Button key={i} variant="outline" className="h-9 w-full justify-between text-[13px]" title="Vai alla porta" onClick={() => p.onVai(dove[0].id)}>
                {testo}<LocateFixed className="h-4 w-4 shrink-0" />
              </Button>
            ) : <p key={i} className="flex h-9 items-center rounded-md border border-dashed px-3">{testo}<span className="ml-2 shrink-0 text-muted-foreground">non in questa tavola</span></p>;
          })}
          <p className="text-muted-foreground">
            {[c.sources.map((s) => SOURCE_WORDS[s]).join(" + "), seenWords(c), speedLabel(c.speedMbps),
              c.cavo?.fascio ? `fascio di ${c.cavo.fascio.membri.length} cavi` : null].filter(Boolean).join(" · ")}
          </p>
          {(c.cavo?.frasi.length ?? 0) > 0 && (
            <ul className="list-disc pl-5">{c.cavo!.frasi.slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}</ul>
          )}
          <p><Link href="/topology" className="underline">Per correggere questo cavo: Topologia</Link></p>
        </div>
      )}
      {porta && apparato && <div className={c ? "mt-2 border-t pt-2" : ""}><RigheDiPorta porta={porta} apparato={apparato} /></div>}
    </section>
  );
}
