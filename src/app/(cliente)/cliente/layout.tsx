import { auth } from "@/lib/auth";
import { FUSO_UTENTI } from "@/lib/db-date";
import { contestoCliente } from "@/lib/cliente/contesto";
import { Intestazione } from "@/components/cliente/intestazione";

/** Area a parte: niente menu laterale, larghezza massima 1600 px. */
export default async function LayoutCliente({ children }: { children: React.ReactNode }) {
  const c = await contestoCliente();
  const sessione = await auth();
  const nomeUtente = sessione?.user?.name ?? "";
  const ora = c.ora.toLocaleTimeString("it-IT", {
    timeZone: FUSO_UTENTI,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (
    <div className="vista-cliente min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4">
        <Intestazione
          nomeCliente={c.nomeCliente}
          ora={ora}
          nomeUtente={nomeUtente}
          amministratore={c.amministratore}
        />
        {children}
      </div>
    </div>
  );
}
