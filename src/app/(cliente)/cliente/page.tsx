import { Pannello } from "@/components/shared/console";
import { ElencoAttenzione } from "@/components/cliente/elenco-attenzione";
import { AccessiUltime24Ore, AnelloRischio, BarrePerRete, BarreReti, GraficoAccesi } from "@/components/cliente/grafici-casa";
import { RiquadroPiccolo } from "@/components/cliente/riquadro-piccolo";
import Link from "next/link";
import { ComponiCasa } from "@/components/cliente/componi-casa";
import { RIQUADRI_CASA, leggiDisposizione, disposizionePredefinita, type VoceDisposizione } from "@/lib/cliente/casa";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import type { ReactNode } from "react";
import { graficiCasa, ORE_GRAFICO_ACCESI } from "@/lib/cliente/grafici";
import {
  ordinaAttenzione,
  schedeAttive,
  type RiquadroCliente,
  type VoceAttenzione,
} from "@/lib/cliente/registro";

function Apri({ href, testo }: { href: string; testo: string }) {
  return (
    <Link href={href} className="nascosto-stampa text-[13px] font-medium text-cian-testo hover:underline">
      {testo} →
    </Link>
  );
}

/**
 * Casa della vista cliente: i moduli in una striscia di riquadri piccoli, sotto i grafici presi
 * dalla Dashboard, a destra «Cosa richiede attenzione» (Riccardo, 11/11/2026).
 */
export default async function CasaCliente({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const componi = (await searchParams).componi === "1";
  const c = await contestoCliente();
  const schede = await schedeAttive(c);
  const voci: VoceAttenzione[] = [];
  const riquadri: Array<{ id: string; titolo: string; riquadro: RiquadroCliente }> = [];
  for (const scheda of schede) {
    try {
      voci.push(...(await scheda.attenzione(c)));
    } catch (e) {
      console.error("[cliente] attenzione", scheda.id, e instanceof Error ? e.message : String(e));
    }
    try {
      riquadri.push({
        id: scheda.id,
        titolo: scheda.titolo,
        riquadro: await scheda.riquadro(c),
      });
    } catch (e) {
      console.error("[cliente] riquadro", scheda.id, e instanceof Error ? e.message : String(e));
    }
  }
  const ordinate = ordinaAttenzione(voci);
  const etichetta = ordinate.length === 1 ? "1 voce" : `${ordinate.length} voci`;
  const g = graficiCasa(c, new Set(schede.map((s) => s.id)));
  // La casa è componibile: quali riquadri, in che ordine e in che misura lo dice la disposizione
  // del cliente (src/lib/cliente/casa.ts). Qui c'è solo cosa disegna ogni riquadro della libreria.
  let disposizione: VoceDisposizione[] = disposizionePredefinita();
  try {
    disposizione = nelCliente(c, (db) => leggiDisposizione(db));
  } catch (e) {
    console.error("[cliente] disposizione della casa:", e instanceof Error ? e.message : String(e));
  }
  const corpo: Record<string, { titolo: string; azioni: ReactNode; contenuto: ReactNode } | null> = {
    indirizzi: g.accesi && {
      titolo: `Indirizzi in uso nelle ultime ${ORE_GRAFICO_ACCESI} ore`,
      azioni: <Apri href="/cliente/reti" testo="Reti" />,
      contenuto: <GraficoAccesi dati={g.accesi} />,
    },
    accessi: g.accessi && {
      titolo: "Accessi falliti · ultime 24 ore",
      azioni: (
        <Apri
          href={g.accessi.dettaglio ? "/cliente/dominio" : "/cliente/log-sicurezza"}
          testo={g.accessi.dettaglio ? "Dominio e accessi" : "Log di sicurezza"}
        />
      ),
      contenuto: <AccessiUltime24Ore dati={g.accessi} />,
    },
    reti: g.reti.length > 0 ? { titolo: "Le tue reti", azioni: <Apri href="/cliente/reti" testo="Reti" />, contenuto: <BarreReti reti={g.reti} /> } : null,
    rischio: g.rischio && {
      titolo: "Rischio del dominio",
      azioni: <Apri href="/cliente/dominio" testo="Dominio e accessi" />,
      contenuto: <AnelloRischio dati={g.rischio} />,
    },
    "per-rete": g.perRete.length > 0
      ? { titolo: "Da sistemare per rete", azioni: <Apri href="/cliente/da-sistemare" testo="Da sistemare" />, contenuto: <BarrePerRete reti={g.perRete} /> }
      : null,
  };
  const senzaDati = RIQUADRI_CASA.filter((r) => !corpo[r.id]).map((r) => r.id);
  const mostrati = disposizione.filter((v) => v.visibile && corpo[v.id]);

  // «Cosa richiede attenzione» sta in una colonna stretta a destra, con la sua barra di scorrimento:
  // in testa a tutta larghezza era la parte più grossa dello schermo (Riccardo, 11/11/2026).
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, riquadri.length)}, minmax(0, 1fr))` }}>
          {riquadri.map((r) => (
            <RiquadroPiccolo key={r.id} id={r.id} titolo={r.titolo} riquadro={r.riquadro} />
          ))}
        </div>
        {c.amministratore && componi && <ComponiCasa iniziale={disposizione} libreria={RIQUADRI_CASA} senzaDati={senzaDati} />}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {mostrati.map((v) => {
            const r = corpo[v.id];
            if (!r) return null;
            return (
              <Pannello key={v.id} titolo={r.titolo} azioni={r.azioni} className={v.misura === "intera" ? "lg:col-span-2" : undefined}>
                {r.contenuto}
              </Pannello>
            );
          })}
        </div>
        {c.amministratore && !componi && (
          <p className="nascosto-stampa text-[13px]">
            <Link href="/cliente?componi=1" className="font-medium text-cian-testo hover:underline">
              Componi la casa
            </Link>
            <span className="ml-2 text-muted-foreground">Scegli quali riquadri vede questo cliente, in che ordine e in che misura. Lo vedi solo tu.</span>
          </p>
        )}
      </div>
      <div className="xl:sticky xl:top-4">
        <Pannello titolo="Cosa richiede attenzione" conteggio={etichetta}>
          <div className="scorre-attenzione xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto xl:pr-1">
            <ElencoAttenzione voci={ordinate} />
          </div>
        </Pannello>
      </div>
    </div>
  );
}
