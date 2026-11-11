import { CircleAlert, TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { Pannello, Vuoto } from "@/components/shared/console";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { contestoCliente } from "@/lib/cliente/contesto";
import { daSistemare, schedaDaSistemare, type DaSistemare, type DaSistemareApparato } from "@/lib/cliente/schede/da-sistemare";
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

function conto(gravi: number, alte: number): string {
  const parti: string[] = [];
  if (gravi > 0) parti.push(`${gravi} gravi`);
  if (alte > 0) parti.push(`${alte} alte`);
  return parti.join(" · ");
}

function Segno({ gravi }: { gravi: number }) {
  if (gravi > 0) {
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

function RigaApparato({ apparato }: { apparato: DaSistemareApparato }) {
  return (
    <div className="flex items-start gap-2 border-b py-2 text-sm last:border-b-0">
      <Segno gravi={apparato.gravi} />
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-semibold">{apparato.nome}</span>
          {apparato.dettaglio && <span className="ml-2 text-[13px] text-muted-foreground">{apparato.dettaglio}</span>}
        </p>
        <p className="text-[13px] text-muted-foreground">{conto(apparato.gravi, apparato.alte)}</p>
        <p>{apparato.cosa}</p>
      </div>
      {apparato.rimedio && <p className="max-w-[40%] shrink-0 text-[13px]">rimedio: {apparato.rimedio}</p>}
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

  return (
    <PaginaModulo titolo="Da sistemare" contesto={quando ? `ultimo controllo: ${quando}` : undefined}>
      <Pannello titolo="Per apparato, dal più grave" conteggio={dati?.apparati.length}>
        {rotto || !dati ? (
          <p className="text-sm">Dato non disponibile</p>
        ) : dati.apparati.length === 0 ? (
          <Vuoto titolo="Niente da sistemare" />
        ) : (
          <div>
            {dati.apparati.map((apparato) => (
              <RigaApparato key={apparato.chiave} apparato={apparato} />
            ))}
          </div>
        )}
      </Pannello>
    </PaginaModulo>
  );
}
