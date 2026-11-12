import { Pannello } from "@/components/shared/console";
import { ElencoAttenzione } from "@/components/cliente/elenco-attenzione";
import { AccessiDaDove, AccessiPerUtente, AndamentoAccessi, AnelloRischio } from "@/components/cliente/grafici-casa";
import { BarreSubnet, LegendaSubnet } from "@/components/dashboard/barre-subnet";
import { ModuliCompatti } from "@/components/dashboard/moduli-compatti";
import { BarreRilieviPerRete, FilaIndicatori, RigaSicurezza } from "@/components/dashboard/widget";
import { LegendaGravita } from "@/components/shared/console";
import { StatusChangeFeed } from "@/components/shared/status-change-feed";
import { StatusOverTimeChart } from "@/components/shared/status-over-time-chart";
import { datiDashboard, moduliDashboard, type DatiDashboard } from "@/lib/dashboard/dati";
import { ApparatiNuovi, Certificati, Disponibilita, ImportantiSpenti, SistemiOperativi } from "@/components/cliente/riquadri-altri";
import { RiquadroPiccolo } from "@/components/cliente/riquadro-piccolo";
import { RiquadroPorte } from "@/components/cliente/riquadro-porte";
import { RiquadroTopologia } from "@/components/cliente/riquadro-topologia";
import { apparatiConPorte, type ApparatoConPorte } from "@/lib/cliente/schede/apparati";
import Link from "next/link";
import { GrigliaCasa, type ContenutoRiquadro } from "@/components/cliente/griglia-casa";
import { RIGA_PX, RIQUADRI_CASA, leggiDisposizione, disposizionePredefinita, type VoceDisposizione } from "@/lib/cliente/casa";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import { graficiCasa } from "@/lib/cliente/grafici";
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
  // «Porte di rete»: solo con il modulo Apparati attivo e almeno un apparato con le porte lette.
  const conApparati = schede.some((s) => s.id === "apparati");
  let conPorte: ApparatoConPorte[] = [];
  if (schede.some((s) => s.id === "apparati")) {
    try {
      conPorte = nelCliente(c, (db) => apparatiConPorte(db));
    } catch (e) {
      console.error("[cliente] porte di rete:", e instanceof Error ? e.message : String(e));
    }
  }
  // I widget della Dashboard: stessi dati, stessi componenti. Un guasto qui non fa cadere la casa.
  let dash: DatiDashboard | null = null;
  let moduli: Awaited<ReturnType<typeof moduliDashboard>> | null = null;
  try {
    dash = await datiDashboard(c.tenantCode, c.moduli);
    if (c.amministratore) moduli = await moduliDashboard(c.tenantCode, "admin");
  } catch (e) {
    console.error("[cliente] widget della Dashboard:", e instanceof Error ? e.message : String(e));
  }
  // Riccardo, 12/11/2026: alcuni riquadri sono solo per amministratori. Al Cliente non si mostrano né si offrono.
  const perTutti = (id: string): boolean => c.amministratore || !RIQUADRI_CASA.find((r) => r.id === id)?.soloAmministratori;
  disposizione = disposizione.filter((v) => perTutti(v.id));
  const libreria = RIQUADRI_CASA.filter((r) => perTutti(r.id));
  // Il grafico vuole l'altezza in pixel: quella della sua casella, tolti titolo, tasti e legenda.
  const righeGrafico = disposizione.find((v) => v.id === "indirizzi")?.a ?? 5;
  const altezzaGrafico = Math.max(140, righeGrafico * RIGA_PX + (righeGrafico - 1) * 16 - 170);
  const apriAccessi = g.accessi?.dettaglio
    ? <Apri href="/cliente/dominio" testo="Dominio e accessi" />
    : <Apri href="/cliente/log-sicurezza" testo="Log di sicurezza" />;
  const contenuti: ContenutoRiquadro[] = [
    // I widget della Dashboard, gli stessi componenti e gli stessi conti (src/lib/dashboard/dati.ts).
    { id: "indicatori", titolo: "Numeri della rete", azioni: null, nudo: true, contenuto: dash ? <div className="flex h-full flex-wrap items-stretch gap-2"><FilaIndicatori dati={dash} dove="cliente" /></div> : null },
    { id: "sicurezza", titolo: "Sicurezza", azioni: null, nudo: true, contenuto: dash ? <div className="h-full [&>div]:h-full"><RigaSicurezza k={dash.sicurezza} accessi={dash.accessi} daSistemare={dash.daSistemare} dove="cliente" /></div> : null },
    {
      id: "indirizzi",
      titolo: "Stato host nel tempo",
      azioni: <Apri href="/cliente/reti" testo="Reti" />,
      contenuto: <StatusOverTimeChart altezza={altezzaGrafico} />,
    },
    {
      id: "transizioni",
      titolo: "Transizioni recenti",
      azioni: <Apri href="/cliente/apparati" testo="Apparati" />,
      contenuto: <StatusChangeFeed hrefHost="/cliente/apparati" />,
    },
    {
      id: "moduli",
      titolo: "Moduli",
      azioni: <Apri href="/settings/moduli" testo="Moduli" />,
      contenuto: moduli ? <ModuliCompatti riquadri={moduli.riquadri} /> : null,
    },
    {
      id: "accessi-andamento",
      titolo: "Accessi falliti · ultime 24 ore",
      azioni: apriAccessi,
      contenuto: g.accessi ? <AndamentoAccessi dati={g.accessi} /> : null,
    },
    {
      id: "accessi-utenti",
      titolo: "Accessi falliti per utente",
      azioni: apriAccessi,
      contenuto: g.accessi?.dettaglio ? <AccessiPerUtente dati={g.accessi} /> : null,
    },
    {
      id: "accessi-origini",
      titolo: "Accessi falliti: da dove",
      azioni: apriAccessi,
      contenuto: g.accessi?.dettaglio && g.accessi.daDove.length > 0 ? <AccessiDaDove dati={g.accessi} /> : null,
    },
    {
      id: "reti",
      titolo: "Subnet",
      azioni: <Apri href="/cliente/reti" testo="Vedi tutte" />,
      contenuto: dash && dash.networks.length > 0 ? <div className="-m-3"><BarreSubnet reti={dash.networks} hrefRete={() => "/cliente/reti"} /><LegendaSubnet /></div> : null,
    },
    {
      id: "rischio",
      titolo: "Rischio del dominio",
      azioni: <Apri href="/cliente/dominio" testo="Dominio e accessi" />,
      contenuto: g.rischio ? <AnelloRischio dati={g.rischio} /> : null,
    },
    {
      id: "per-rete",
      titolo: "Cose da sistemare per rete",
      azioni: <LegendaGravita />,
      contenuto: dash && dash.rilieviRete.length > 0 ? <div className="space-y-2"><BarreRilieviPerRete reti={dash.rilieviRete} dove="cliente" /></div> : null,
    },
    { id: "nuovi", titolo: "Apparati nuovi in rete", azioni: <Apri href="/cliente/apparati" testo="Apparati" />, contenuto: g.nuovi ? <ApparatiNuovi dati={g.nuovi} /> : null },
    {
      id: "importanti",
      titolo: "Apparati importanti spenti",
      azioni: <Apri href="/cliente/apparati" testo="Apparati" />,
      contenuto: g.importanti ? <ImportantiSpenti dati={g.importanti} /> : null,
    },
    {
      id: "disponibilita",
      titolo: "Disponibilità · ultimi 30 giorni",
      azioni: <Apri href="/cliente/apparati" testo="Apparati" />,
      contenuto: g.disponibilita ? <Disponibilita dati={g.disponibilita} /> : null,
    },
    {
      id: "sistemi",
      titolo: "Sistemi operativi",
      azioni: <Apri href="/cliente/da-sistemare" testo="Da sistemare" />,
      contenuto: g.sistemi ? <SistemiOperativi dati={g.sistemi} /> : null,
    },
    { id: "certificati", titolo: "Certificati", azioni: <Apri href="/cliente/reti" testo="Reti" />, contenuto: g.certificati ? <Certificati dati={g.certificati} /> : null },
  ].filter((r) => perTutti(r.id));
  const inModifica = c.amministratore && componi;

  // «Cosa richiede attenzione» sta in una colonna stretta a destra, con la sua barra di scorrimento:
  // in testa a tutta larghezza era la parte più grossa dello schermo (Riccardo, 11/11/2026).
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, riquadri.length + (conPorte.length > 0 ? 1 : 0) + (conApparati ? 1 : 0))}, minmax(0, 1fr))` }}>
          {riquadri.map((r) => (
            <RiquadroPiccolo key={r.id} id={r.id} titolo={r.titolo} riquadro={r.riquadro} />
          ))}
          {conPorte.length > 0 && <RiquadroPorte apparati={conPorte} />}
          {conApparati && <RiquadroTopologia apparatiDiRete={conPorte.length} />}
        </div>
        <GrigliaCasa key={inModifica ? "modifica" : "vista"} iniziale={disposizione} riquadri={contenuti} libreria={libreria} modifica={inModifica} />
        {c.amministratore && !componi && (
          <p className="nascosto-stampa text-[13px]">
            <Link href="/cliente?componi=1" className="font-medium text-cian-testo hover:underline">
              Componi la casa
            </Link>
            <span className="ml-2 text-muted-foreground">Sposta, ridimensiona, nascondi o aggiungi i riquadri di questo cliente. Lo vedi solo tu.</span>
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
