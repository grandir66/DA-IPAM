import Link from "next/link";
import type { IndirizzoCliente } from "@/lib/cliente/schede/reti";

const FONDO: Record<IndirizzoCliente["stato"], string> = {
  acceso: "bg-foreground",
  spento: "bg-muted-foreground",
  libero: "border border-foreground/30",
};

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
        const classe = `block aspect-square rounded-sm ${FONDO[indirizzo.stato]} ${scelto ? "outline outline-2 outline-offset-1 outline-foreground" : ""}`;
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
