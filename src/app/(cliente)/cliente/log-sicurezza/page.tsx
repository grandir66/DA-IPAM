import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import { logSicurezza, schedaLogSicurezza, type AvvisoCliente, type LogSicurezza } from "@/lib/cliente/schede/log-sicurezza";
import type { Gravita } from "@/lib/cliente/registro";
import { FUSO_UTENTI } from "@/lib/db-date";

function Segno({ gravita }: { gravita: Gravita }) {
  if (gravita === "grave") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.guasto.classi}`}>
        <TriangleAlert className="size-4" aria-hidden />
      </span>
    );
  }
  if (gravita === "attenzione") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.attenzione.classi}`}>
        <CircleAlert className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.da_verificare.classi}`}>
      <Info className="size-4" aria-hidden />
    </span>
  );
}

function etichettaGiorno(giorno: string): string {
  const [y, m, d] = giorno.split("-").map(Number);
  const nome = new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, weekday: "short" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)),
  );
  return nome.replace(/\.$/, "");
}

function quanti(n: number, uno: string, tanti: string): string {
  return `${n} ${n === 1 ? uno : tanti}`;
}

function BarreSetteGiorni({ giorni }: { giorni: LogSicurezza["perGiorno"] }) {
  const massimo = Math.max(0, ...giorni.map((g) => g.avvisi));
  return (
    <div className="flex items-end gap-2">
      {giorni.map((giorno) => {
        const alto = massimo > 0 && giorno.avvisi === massimo;
        const altezza = massimo > 0 ? Math.round((giorno.avvisi / massimo) * 100) : 0;
        return (
          <div key={giorno.giorno} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="font-mono text-[13px]">{giorno.avvisi}</span>
            <div className="flex h-24 w-full items-end rounded-sm bg-[var(--vc-barra-fondo)]">
              <div
                className={`w-full rounded-sm ${alto ? "bg-[var(--vc-acceso)]" : "bg-[var(--vc-cian)]"}`}
                style={{ height: `${altezza}%` }}
              />
            </div>
            <span className="text-[13px] text-muted-foreground">{etichettaGiorno(giorno.giorno)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RigaAvviso({ avviso }: { avviso: AvvisoCliente }) {
  return (
    <div className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0">
      <Segno gravita={avviso.gravita} />
      <span className="min-w-0 flex-1">
        {avviso.testo}
        {avviso.volte > 1 && <span className="ml-2 font-mono">× {avviso.volte}</span>}
      </span>
      <span className="shrink-0 text-[13px] text-muted-foreground">
        {avviso.dove ? `${avviso.dove} · ` : ""}
        <TempoRelativo data={avviso.quando} />
      </span>
    </div>
  );
}

/** /cliente/log-sicurezza */
export default async function PaginaLogSicurezza() {
  const c = await contestoCliente();
  if (!(await schedaLogSicurezza.attiva(c))) redirect("/cliente");
  const fonte = c.moduli.find((m) => m.category === "siem")?.label ?? "log di sicurezza";

  let log: LogSicurezza | null = null;
  let rotto = false;
  try {
    log = nelCliente(c, (db) => logSicurezza(db, c.ora));
  } catch (e) {
    rotto = true;
    console.error("[cliente] log di sicurezza:", e instanceof Error ? e.message : String(e));
  }

  const senza = log ? Math.max(0, log.totaleComputer - log.sottoControllo) : 0;
  const contesto = log
    ? `fonte: ${fonte} · ${quanti(log.sottoControllo, "computer sotto controllo", "computer sotto controllo")} su ${log.totaleComputer}`
    : `fonte: ${fonte}`;

  return (
    <PaginaModulo titolo="Log di sicurezza" contesto={contesto}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Pannello titolo="Avvisi negli ultimi 7 giorni">
          {rotto || !log ? (
            <p className="text-sm">Dato non disponibile</p>
          ) : (
            <div className="space-y-3">
              <BarreSetteGiorni giorni={log.perGiorno} />
              <p className="text-[13px] text-muted-foreground">
                {quanti(log.totaleAperti, "aperto", "aperti")} · {quanti(log.chiusiNelMese, "chiuso nel mese", "chiusi nel mese")} · {quanti(senza, "computer senza controllo", "computer senza controllo")}
              </p>
            </div>
          )}
        </Pannello>
        <Pannello titolo="Avvisi aperti" conteggio={log?.totaleAperti}>
          {rotto || !log ? (
            <p className="text-sm">Dato non disponibile</p>
          ) : log.aperti.length === 0 ? (
            <Vuoto titolo="Nessun avviso aperto" />
          ) : (
            <div>
              {log.aperti.map((avviso) => (
                <RigaAvviso key={`${avviso.quando}-${avviso.testo}-${avviso.dove ?? ""}`} avviso={avviso} />
              ))}
            </div>
          )}
        </Pannello>
      </div>
    </PaginaModulo>
  );
}
