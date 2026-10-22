import { cn } from "@/lib/utils";
import { conLibrenms } from "@/lib/scheda/librenms-vista";
import type { ContestoScheda } from "./contesto";
import { oraBreve } from "./librenms-pezzi";

/** Da dove vengono i dati. `nota` sostituisce il testo di default dell'esito («nessun agente», «non abbinato»…). */
export type Fonte = { nome: string; esito: "ok" | "assente" | "non_abbinato"; quando?: string; nota?: string };

/**
 * Riga delle fonti, in fondo alla Panoramica: una fonte mancante si dice qui, una volta, al posto
 * delle card vuote piene di «—». Il segno accompagna sempre la parola (✓ ● –).
 */
export function RigaFonti({ fonti }: { fonti: Fonte[] }) {
  if (fonti.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="font-semibold">Dati da:</span>
      {fonti.map((f) => (
        <span key={f.nome} className={cn(f.esito === "ok" && "text-foreground")}>
          <span aria-hidden>{f.esito === "ok" ? "✓" : f.esito === "non_abbinato" ? "●" : "–"} </span>
          {f.nome}
          {f.esito === "ok" ? (f.quando ? ` ${f.quando}` : "") : `: ${f.nota ?? (f.esito === "non_abbinato" ? "non abbinato" : "nessun dato")}`}
        </span>
      ))}
    </p>
  );
}

/** La riga delle fonti della Panoramica con la voce di LibreNMS dalle tabelle `librenms_*` (L4), se la sua lettura è accesa. */
export function RigaFontiScheda({ ctx, fonti }: { ctx: ContestoScheda; fonti: Fonte[] }) {
  return <RigaFonti fonti={conLibrenms(fonti, ctx.librenmsDati, oraBreve)} />;
}
