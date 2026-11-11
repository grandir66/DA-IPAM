import { CircleCheck, CircleOff } from "lucide-react";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import type { ApparatoCliente } from "@/lib/cliente/schede/reti";

function testoCollegamento(c: NonNullable<ApparatoCliente["collegatoA"]>): string {
  const testa = c.switch ? `${c.switch}, porta ${c.porta}` : `porta ${c.porta}`;
  const pezzi = [testa];
  if (c.vlan != null) pezzi.push(`VLAN ${c.vlan}`);
  if (c.velocita) pezzi.push(c.velocita);
  return pezzi.join(" · ");
}

function testoPorte(porte: ApparatoCliente["porteAperte"]): string {
  return porte.map((p) => (p.nome ? `${p.numero} ${p.nome}` : String(p.numero))).join(", ");
}

/** Scheda di un indirizzo. Una riga senza dato non si disegna. */
export function SchedaApparato({ apparato }: { apparato: ApparatoCliente }) {
  const collegamento = apparato.collegatoA ? testoCollegamento(apparato.collegatoA) : null;
  const porte = apparato.porteAperte.length > 0 ? testoPorte(apparato.porteAperte) : null;
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{apparato.nome}</h3>
        <span className="font-mono text-sm">{apparato.ip}</span>
      </div>
      {apparato.acceso ? (
        <p className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO.ok.classi}`}>
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          acceso
        </p>
      ) : (
        <p className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO.grigio.classi}`}>
          <CircleOff className="size-4 shrink-0" aria-hidden />
          spento
        </p>
      )}
      <dl className="space-y-1 text-sm">
        <Riga etichetta="Cos'è" valore={apparato.cosa} />
        {apparato.vistoIl && <Riga etichetta="Visto l'ultima volta" valore={apparato.vistoIl} />}
        {collegamento && <Riga etichetta="Collegato a" valore={collegamento} />}
        {porte && <Riga etichetta="Porte aperte" valore={porte} />}
      </dl>
    </section>
  );
}

function Riga({ etichetta, valore }: { etichetta: string; valore: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-[13px] text-muted-foreground">{etichetta}</dt>
      <dd>{valore}</dd>
    </div>
  );
}
