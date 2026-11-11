import { CircleAlert, TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { Etichetta, Pannello, Vuoto } from "@/components/shared/console";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { contestoCliente } from "@/lib/cliente/contesto";
import {
  daSistemare,
  schedaDaSistemare,
  type DaSistemare,
  type ProgrammaDaAggiornare,
} from "@/lib/cliente/schede/da-sistemare";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";

function dataItaliana(raw: string | null): string | null {
  if (!raw) return null;
  const data = parseDbDate(raw);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
}

function suApparati(n: number): string {
  return n === 1 ? "su 1 apparato" : `su ${n} apparati`;
}

function coseSu(n: number, uno: string, tanti: string, apparati: number): string {
  const cosa = n === 1 ? `1 ${uno}` : `${n} ${tanti}`;
  return `${cosa} ${suApparati(apparati)}`;
}

function Segno({ grave }: { grave: boolean }) {
  if (grave) {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.guasto.classi}`}>
        <TriangleAlert className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.attenzione.classi}`}>
      <CircleAlert className="size-4" aria-hidden />
    </span>
  );
}

function RigaProgramma({ programma }: { programma: ProgrammaDaAggiornare }) {
  return (
    <div className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0">
      <Segno grave={programma.gravita === "grave"} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{programma.nome}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">da aggiornare {suApparati(programma.apparati)}</span>
      </span>
      {programma.sfruttato && <Etichetta tono="neutro" mono={false}>già usato negli attacchi</Etichetta>}
    </div>
  );
}

/** /cliente/da-sistemare */
export default async function PaginaDaSistemare() {
  const c = await contestoCliente();
  if (!(await schedaDaSistemare.attiva(c))) redirect("/cliente");

  let dati: DaSistemare | null = null;
  let rotto = false;
  try {
    dati = daSistemare(c);
  } catch (e) {
    rotto = true;
    console.error("[cliente] da sistemare:", e instanceof Error ? e.message : String(e));
  }

  const quando = dati ? dataItaliana(dati.ultimoControllo) : null;
  const altriProgrammi = dati ? dati.totaleProgrammi - dati.programmi.length : 0;
  const altreCose = dati?.daCorreggere ? dati.daCorreggere.rilievi - dati.daCorreggere.titoli.length : 0;

  return (
    <PaginaModulo titolo="Da sistemare" contesto={quando ? `ultimo controllo: ${quando}` : undefined}>
      <div className="space-y-4">
        <Pannello
          titolo="Cosa aggiornare"
          conteggio={dati ? (dati.totaleProgrammi === 1 ? "1 programma" : `${dati.totaleProgrammi} programmi`) : undefined}
        >
          {rotto || !dati ? (
            <p className="text-sm">Dato non disponibile</p>
          ) : dati.programmi.length === 0 ? (
            <Vuoto titolo="Nessun programma da aggiornare" />
          ) : (
            <div>
              {dati.programmi.map((programma) => (
                <RigaProgramma key={programma.chiave} programma={programma} />
              ))}
              {altriProgrammi > 0 && (
                <p className="pt-2 text-[13px] text-muted-foreground">
                  {altriProgrammi === 1 ? "e un altro programma" : `e altri ${altriProgrammi} programmi`}
                </p>
              )}
            </div>
          )}
        </Pannello>
        {dati?.daCorreggere && (
          <Pannello
            titolo="Da correggere"
            sottotitolo="Non serve un aggiornamento: va cambiata un'impostazione."
            conteggio={coseSu(dati.daCorreggere.rilievi, "cosa", "cose", dati.daCorreggere.apparati)}
          >
            <div>
              {dati.daCorreggere.titoli.map((titolo, i) => (
                <p key={`${i}-${titolo}`} className="border-b py-2 text-sm last:border-b-0">{titolo}</p>
              ))}
              {altreCose > 0 && (
                <p className="pt-2 text-[13px] text-muted-foreground">{altreCose === 1 ? "e un'altra" : `e altre ${altreCose}`}</p>
              )}
            </div>
          </Pannello>
        )}
        {dati?.altri && (
          <p className="text-sm text-muted-foreground">
            Altri {coseSu(dati.altri.rilievi, "problema tecnico", "problemi tecnici", dati.altri.apparati)}.
          </p>
        )}
      </div>
    </PaginaModulo>
  );
}
