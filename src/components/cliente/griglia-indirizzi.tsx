"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Etichetta, Legenda, Pannello, VoceSelezionabile } from "@/components/shared/console";
import { ASSENTE_DOPO_GIORNI } from "@/lib/hosts/assenti";
import type { IndirizzoCliente, ReteCliente } from "@/lib/cliente/schede/reti";

const FONDO: Record<IndirizzoCliente["stato"], string> = {
  acceso: "bg-[var(--vc-acceso)]",
  spento: "bg-[var(--vc-spento)]",
  assente: "bg-[var(--vc-assente)]",
  libero: "border border-dashed border-[var(--vc-bordo)]",
};

/** Quattro quadretti veri, le stesse classi della griglia. */
export function LegendaIndirizzi() {
  return (
    <Legenda
      voci={[
        { classe: FONDO.acceso, testo: "acceso" },
        { classe: FONDO.spento, testo: "spento" },
        { classe: FONDO.assente, testo: `non si vede da più di ${ASSENTE_DOPO_GIORNI} giorni` },
        { classe: FONDO.libero, testo: "libero" },
      ]}
    />
  );
}

/** Elenco «Le reti»: la rete scelta ha fondo e bordo, come «Per tipo». */
export function ElencoReti({ reti, sceltaId }: { reti: ReteCliente[]; sceltaId: number | null }) {
  const router = useRouter();
  return (
    <Pannello titolo="Le reti" conteggio={reti.length}>
      {reti.length === 0 ? (
        <p className="text-sm">Nessuna rete dichiarata</p>
      ) : (
        <div className="grid gap-2">
          {reti.map((rete) => (
            <VoceSelezionabile
              key={rete.id}
              scelta={rete.id === sceltaId}
              onScegli={() => router.push(`/cliente/reti?rete=${rete.id}`)}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{rete.nome}</span>
                {rete.vlan != null && <Etichetta>VLAN {rete.vlan}</Etichetta>}
                <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
                  {rete.inUso} su {rete.totale}
                </span>
              </span>
            </VoceSelezionabile>
          ))}
        </div>
      )}
    </Pannello>
  );
}

/** 32 quadretti per riga. I liberi non sono un link. */
export function GrigliaIndirizzi({
  reteId,
  indirizzi,
  ipScelto,
}: {
  reteId: number;
  indirizzi: IndirizzoCliente[];
  ipScelto: string | null;
}) {
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(32, minmax(0, 1fr))" }}>
      {indirizzi.map((indirizzo) => {
        const scelto = ipScelto === indirizzo.ip;
        const classe = `block aspect-square rounded-sm ${FONDO[indirizzo.stato]} ${scelto ? "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--vc-giallo)]" : ""}`;
        if (indirizzo.stato === "libero") {
          return <span key={indirizzo.ip} title={indirizzo.ip} className={classe} />;
        }
        return (
          <Link
            key={indirizzo.ip}
            href={`/cliente/reti?rete=${reteId}&ip=${encodeURIComponent(indirizzo.ip)}`}
            title={indirizzo.ip}
            aria-label={indirizzo.ip}
            aria-current={scelto ? "true" : undefined}
            className={classe}
          />
        );
      })}
    </div>
  );
}
