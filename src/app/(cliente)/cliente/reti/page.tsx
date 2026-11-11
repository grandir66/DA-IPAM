import Link from "next/link";
import { redirect } from "next/navigation";
import { Etichetta, Pannello } from "@/components/shared/console";
import { GrigliaIndirizzi } from "@/components/cliente/griglia-indirizzi";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { SchedaApparato } from "@/components/cliente/scheda-apparato";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import { ASSENTE_DOPO_GIORNI } from "@/lib/hosts/assenti";
import {
  apparatoCliente,
  indirizziDellaRete,
  retiCliente,
  retiViste,
  schedaReti,
  type ApparatoCliente,
  type IndirizzoCliente,
  type ReteCliente,
  type ReteVista,
} from "@/lib/cliente/schede/reti";

function parametro(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function quantiIndirizzi(n: number): string {
  return n === 1 ? "1 indirizzo" : `${n} indirizzi`;
}

/** /cliente/reti?rete=<id>&ip=<ip> */
export default async function PaginaReti({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await contestoCliente();
  if (!(await schedaReti.attiva(c))) redirect("/cliente");
  const q = await searchParams;
  const reteParam = Number(parametro(q.rete));
  const ipParam = parametro(q.ip);

  const dati = nelCliente(c, (db) => {
    const reti = retiCliente(db);
    const scelta = reti.find((r) => r.id === reteParam) ?? reti[0] ?? null;
    const indirizzi = scelta ? indirizziDellaRete(db, scelta.id) : [];
    const nelQuadro = ipParam != null && indirizzi.some((i) => i.ip === ipParam && i.stato !== "libero");
    const apparato = nelQuadro && ipParam ? apparatoCliente(db, ipParam) : null;
    return { reti, scelta, indirizzi, apparato };
  });

  let viste: ReteVista[] = [];
  let visteAssenti = false;
  try {
    viste = retiViste(c);
  } catch (e) {
    visteAssenti = true;
    console.error("[cliente] reti viste:", e instanceof Error ? e.message : String(e));
  }

  return (
    <PaginaModulo titolo="Reti">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-4">
          <ElencoReti reti={dati.reti} sceltaId={dati.scelta?.id ?? null} />
          {visteAssenti ? (
            <p className="text-sm">Dato non disponibile</p>
          ) : (
            viste.length > 0 && <VisteSulCavo viste={viste} />
          )}
        </div>
        {dati.scelta && (
          <DettaglioRete
            rete={dati.scelta}
            indirizzi={dati.indirizzi}
            ipScelto={ipParam}
            apparato={dati.apparato}
          />
        )}
      </div>
    </PaginaModulo>
  );
}

function ElencoReti({ reti, sceltaId }: { reti: ReteCliente[]; sceltaId: number | null }) {
  return (
    <Pannello titolo="Le reti" conteggio={reti.length}>
      {reti.length === 0 ? (
        <p className="text-sm">Nessuna rete dichiarata</p>
      ) : (
        <ul>
          {reti.map((rete) => {
            const scelta = rete.id === sceltaId;
            return (
              <li key={rete.id} className="border-b last:border-b-0">
                <Link
                  href={`/cliente/reti?rete=${rete.id}`}
                  aria-current={scelta ? "true" : undefined}
                  className={`flex items-center gap-2 py-2 text-sm ${scelta ? "font-semibold" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{rete.nome}</span>
                  {rete.vlan != null && <Etichetta>VLAN {rete.vlan}</Etichetta>}
                  <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                    {rete.inUso} su {rete.totale}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Pannello>
  );
}

function VisteSulCavo({ viste }: { viste: ReteVista[] }) {
  return (
    <Pannello
      titolo="Viste sul cavo, non censite"
      conteggio={viste.length}
      sottotitolo="La sonda le sente passare ma nessuno le ha dichiarate."
    >
      <ul>
        {viste.map((vista) => (
          <li key={`${vista.vlan ?? "no"}-${vista.cidr}`} className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0">
            <span className="min-w-0 flex-1 truncate font-mono">{vista.cidr}</span>
            {vista.vlan != null ? <Etichetta>VLAN {vista.vlan}</Etichetta> : <span className="text-[13px]">senza VLAN</span>}
            <span className="shrink-0 font-mono text-[13px] text-muted-foreground">{quantiIndirizzi(vista.indirizzi)}</span>
          </li>
        ))}
      </ul>
    </Pannello>
  );
}

function DettaglioRete({
  rete,
  indirizzi,
  ipScelto,
  apparato,
}: {
  rete: ReteCliente;
  indirizzi: IndirizzoCliente[];
  ipScelto: string | null;
  apparato: ApparatoCliente | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-base font-semibold">
          {rete.nome} · {rete.cidr}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          pieno = acceso · grigio = spento · chiaro = non si vede da più di {ASSENTE_DOPO_GIORNI} giorni · vuoto = libero
        </p>
      </div>
      <GrigliaIndirizzi reteId={rete.id} indirizzi={indirizzi} ipScelto={ipScelto} />
      {apparato && <SchedaApparato apparato={apparato} />}
    </div>
  );
}
