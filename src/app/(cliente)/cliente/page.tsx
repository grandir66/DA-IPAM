import { Pannello } from "@/components/shared/console";
import { ElencoAttenzione } from "@/components/cliente/elenco-attenzione";
import { AccessiUltime24Ore, AnelloRischio, BarrePerRete, BarreReti, GraficoAccesi } from "@/components/cliente/grafici-casa";
import { RiquadroPiccolo } from "@/components/cliente/riquadro-piccolo";
import Link from "next/link";
import { contestoCliente } from "@/lib/cliente/contesto";
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
export default async function CasaCliente() {
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
        {g.accesi && (
          <Pannello titolo={`Indirizzi in uso nelle ultime ${ORE_GRAFICO_ACCESI} ore`} azioni={<Apri href="/cliente/reti" testo="Reti" />}>
            <GraficoAccesi dati={g.accesi} />
          </Pannello>
        )}
        {g.accessi && (
          <Pannello
            titolo="Accessi falliti · ultime 24 ore"
            azioni={<Apri href={g.accessi.dettaglio ? "/cliente/dominio" : "/cliente/log-sicurezza"} testo={g.accessi.dettaglio ? "Dominio e accessi" : "Log di sicurezza"} />}
          >
            <AccessiUltime24Ore dati={g.accessi} />
          </Pannello>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {g.reti.length > 0 && (
            <Pannello titolo="Le tue reti" azioni={<Apri href="/cliente/reti" testo="Reti" />}>
              <BarreReti reti={g.reti} />
            </Pannello>
          )}
          {g.rischio && (
            <Pannello titolo="Rischio del dominio" azioni={<Apri href="/cliente/dominio" testo="Dominio e accessi" />}>
              <AnelloRischio dati={g.rischio} />
            </Pannello>
          )}
          {g.perRete.length > 0 && (
            <Pannello titolo="Da sistemare per rete" azioni={<Apri href="/cliente/da-sistemare" testo="Da sistemare" />}>
              <BarrePerRete reti={g.perRete} />
            </Pannello>
          )}
        </div>
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
