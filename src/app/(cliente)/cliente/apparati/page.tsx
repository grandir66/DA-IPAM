import { redirect } from "next/navigation";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { SchedaApparato } from "@/components/cliente/scheda-apparato";
import { ElencoApparati, ElencoTipi, PannelloPorte } from "@/components/cliente/pannello-porte";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import { apparatoCliente } from "@/lib/cliente/schede/reti";
import {
  apparatiDelTipo,
  conteggiPerTipo,
  porteDelloSwitch,
  schedaApparati,
  TIPI_CLIENTE,
  type PortaCliente,
  type RigaApparato,
  type TipoCliente,
} from "@/lib/cliente/schede/apparati";

function parametro(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function eTipo(v: string | null): v is TipoCliente {
  return TIPI_CLIENTE.some((t) => t.tipo === v);
}

/** /cliente/apparati?tipo=<tipo>&ip=<ip>&porta=<n> */
export default async function PaginaApparati({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await contestoCliente();
  if (!(await schedaApparati.attiva(c))) redirect("/cliente");
  const q = await searchParams;
  const tipoParam = parametro(q.tipo);
  const ipParam = parametro(q.ip);
  const portaParam = Number(parametro(q.porta));

  const dati = nelCliente(c, (db) => {
    const conteggi = conteggiPerTipo(db);
    const richiesto = eTipo(tipoParam) ? TIPI_CLIENTE.find((t) => t.tipo === tipoParam) ?? null : null;
    const scelto = richiesto ?? TIPI_CLIENTE.find((t) => conteggi[t.tipo] > 0) ?? null;
    const apparati = scelto ? apparatiDelTipo(db, scelto.tipo) : [];
    const riga = ipParam ? apparati.find((a) => a.ip === ipParam) ?? null : null;
    const porte = riga?.haPorte ? porteDelloSwitch(db, riga.ip) : null;
    const scheda = riga && !riga.haPorte ? apparatoCliente(db, riga.ip) : null;
    return { conteggi, scelto, apparati, riga, porte, scheda };
  });

  const voci = TIPI_CLIENTE.filter((t) => dati.conteggi[t.tipo] > 0).map((t) => ({
    ...t,
    conteggio: dati.conteggi[t.tipo],
  }));

  return (
    <PaginaModulo titolo="Apparati">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <ElencoTipi voci={voci} scelto={dati.scelto?.tipo ?? null} />
        {dati.scelto && (
          <Dettaglio
            tipo={dati.scelto.tipo}
            titolo={dati.scelto.titolo}
            apparati={dati.apparati}
            ipScelto={dati.riga?.ip ?? null}
            nome={dati.riga?.nome ?? ""}
            porte={dati.porte}
            portaScelta={Number.isInteger(portaParam) ? portaParam : null}
            scheda={dati.scheda}
          />
        )}
      </div>
    </PaginaModulo>
  );
}

function Dettaglio({
  tipo,
  titolo,
  apparati,
  ipScelto,
  nome,
  porte,
  portaScelta,
  scheda,
}: {
  tipo: TipoCliente;
  titolo: string;
  apparati: RigaApparato[];
  ipScelto: string | null;
  nome: string;
  porte: PortaCliente[] | null;
  portaScelta: number | null;
  scheda: ReturnType<typeof apparatoCliente>;
}) {
  return (
    <div className="space-y-4">
      <ElencoApparati tipo={tipo} titolo={titolo} apparati={apparati} ipScelto={ipScelto} />
      {ipScelto && porte !== null && (
        <PannelloPorte tipo={tipo} ip={ipScelto} nome={nome} porte={porte} portaScelta={portaScelta} />
      )}
      {ipScelto && porte === null && scheda && <SchedaApparato apparato={scheda} />}
    </div>
  );
}
