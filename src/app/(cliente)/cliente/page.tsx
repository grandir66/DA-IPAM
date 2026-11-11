import { Pannello } from "@/components/shared/console";
import { ElencoAttenzione } from "@/components/cliente/elenco-attenzione";
import { RiquadroModulo } from "@/components/cliente/riquadro-modulo";
import { contestoCliente } from "@/lib/cliente/contesto";
import {
  ordinaAttenzione,
  schedeAttive,
  type RiquadroCliente,
  type VoceAttenzione,
} from "@/lib/cliente/registro";

/** Casa della vista cliente. Il registro è ancora vuoto: niente riquadri, niente voci. */
export default async function CasaCliente() {
  const c = await contestoCliente();
  const schede = await schedeAttive(c);
  const voci: VoceAttenzione[] = [];
  const riquadri: Array<{ id: string; titolo: string; icona: string; riquadro: RiquadroCliente }> = [];
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
        icona: scheda.icona,
        riquadro: await scheda.riquadro(c),
      });
    } catch (e) {
      console.error("[cliente] riquadro", scheda.id, e instanceof Error ? e.message : String(e));
    }
  }
  const ordinate = ordinaAttenzione(voci);
  const etichetta = ordinate.length === 1 ? "1 voce" : `${ordinate.length} voci`;
  // «Cosa richiede attenzione» sta in una colonna stretta a destra, con la sua barra di scorrimento:
  // in testa a tutta larghezza era la parte più grossa dello schermo (Riccardo, 11/11/2026).
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-3">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">I moduli attivi</h2>
        <div className="grid grid-cols-2 gap-4 2xl:grid-cols-3">
          {riquadri.map((r) => (
            <RiquadroModulo key={r.id} id={r.id} titolo={r.titolo} icona={r.icona} riquadro={r.riquadro} />
          ))}
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
