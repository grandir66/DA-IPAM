"use client";

/**
 * Tab «Servizi» (su Linux «Servizi e processi»): in cima i servizi del ruolo, poi gli automatici fermi o falliti,
 * poi tutti quelli letti dalla scansione con un filtro. Su Linux anche le porte in ascolto (porta e processo
 * insieme, prima stavano in tre punti) e le pianificazioni cron, che erano in «Processi e schedulazioni».
 * Lo scan legge i servizi «rilevanti», non tutti quelli del sistema: l'elenco dice quanti ne ha letti.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { esitoServizio, raggruppaPorte, serviziDaGuardare, serviziDelRuolo, serviziInAscolto, type ServizioSrv } from "@/lib/scheda/server";
import type { ContestoScheda } from "../../contesto";
import { Riquadro } from "../../riquadro";
import { ElencoServizi, EsitoServizioTesto, Nessun, infoDi, td, th } from "./dati-server";

/** «✓ NTDS  ✓ DNS …» in una riga: i servizi del ruolo, segno e parola insieme. */
export function ServiziDelRuolo({ servizi }: { servizi: ServizioSrv[] }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {servizi.map((s) => {
        const e = esitoServizio(s);
        // Attivo: «✓ NTDS». Altrimenti il segno e lo stato dicono perché non lo è («● SQLBrowser inattivo»).
        return e.livello === "ok"
          ? <span key={s.name} className="whitespace-nowrap"><span aria-hidden>✓ </span><span className="font-mono font-semibold">{s.name}</span></span>
          : <span key={s.name} className="whitespace-nowrap"><span className="font-mono font-semibold">{s.name}</span> <EsitoServizioTesto s={s} /></span>;
      })}
    </p>
  );
}

/** Porte in ascolto raggruppate per processo. */
export function TabellaPorte({ porte, max }: { porte: NonNullable<ReturnType<typeof infoDi>>["listening_ports"]; max?: number }) {
  const gruppi = raggruppaPorte(porte ?? []);
  const mostrati = gruppi.slice(0, max ?? gruppi.length);
  // Se la scansione non dà il processo di nessuna porta, la colonna sarebbe tutta uguale: lo si dice una volta sola.
  const conProcesso = gruppi.some((g) => g.processo);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Porta</th>{conProcesso && <th className={th}>Processo</th>}<th className={th}>Raggiungibile da</th></tr></thead>
        <tbody>
          {mostrati.map((g) => (
            <tr key={`${g.porte.join("-")}-${g.processo}-${g.raggio}`}>
              <td className={`${td} font-mono font-semibold`}>{g.porte.join(" · ")}</td>
              {conProcesso && <td className={`${td} font-mono`}>{g.processo ?? <span className="text-muted-foreground">non letto</span>}</td>}
              <td className={td}>{g.raggio === "solo locale" ? <span className="text-muted-foreground">solo locale</span> : g.raggio}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {gruppi.length > mostrati.length && <p className="mt-1 text-[13px] text-muted-foreground">… altre {gruppi.length - mostrati.length}</p>}
      {!conProcesso && gruppi.length > 0 && <p className="mt-1 text-[13px] text-muted-foreground">La scansione non legge il processo che ascolta su ogni porta.</p>}
    </div>
  );
}

export function ServiziServer({ ctx }: { ctx: ContestoScheda }) {
  const di = infoDi(ctx);
  const [filtro, setFiltro] = useState("");
  const servizi = di?.important_services ?? [];
  const porte = di?.listening_ports ?? [];
  const cron = di?.cron_jobs ?? [];
  const linux = ctx.tipo === "server_linux";

  if (servizi.length === 0 && porte.length === 0 && cron.length === 0) {
    return <Nessun>La scansione non ha letto servizi, porte in ascolto né pianificazioni: usa «Aggiorna» per leggerli.</Nessun>;
  }

  const delRuolo = linux ? serviziInAscolto(servizi, porte) : serviziDelRuolo(servizi, ctx.ruoli);
  const daGuardare = serviziDaGuardare(servizi);
  // La colonna «Descrizione» c'è solo se almeno un servizio ha un nome esteso diverso (su Linux di solito no).
  const conDescrizione = servizi.some((s) => s.display_name && s.display_name !== s.name);
  const f = filtro.trim().toLowerCase();
  const filtrati = f === "" ? servizi : servizi.filter((s) => `${s.name ?? ""} ${s.display_name ?? ""}`.toLowerCase().includes(f));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo={linux ? "In ascolto su una porta" : "Servizi del ruolo"} vuoto={delRuolo.length === 0}>
          <ServiziDelRuolo servizi={delRuolo} />
        </Riquadro>
        <Riquadro titolo={`Da guardare (${daGuardare.length})`} vuoto={servizi.length === 0}>
          {daGuardare.length === 0
            ? <p className="text-[13px]"><span aria-hidden>✓ </span>{linux ? "Nessun servizio fallito." : "Tutti gli automatici sono attivi."}</p>
            : <ElencoServizi servizi={daGuardare} />}
        </Riquadro>
      </div>

      <Riquadro
        titolo={`Servizi letti (${servizi.length})`}
        vuoto={servizi.length === 0}
        azione={<Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Cerca un servizio" aria-label="Cerca un servizio" className="h-8 w-56 text-[13px]" />}
      >
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-card"><tr><th className={th}>Servizio</th>{conDescrizione && <th className={th}>Descrizione</th>}<th className={th}>Stato</th>{!linux && <th className={th}>Avvio</th>}</tr></thead>
            <tbody>
              {filtrati.map((s, i) => (
                <tr key={`${s.name}-${i}`}>
                  <td className={`${td} font-mono font-semibold`}>{s.name ?? "?"}</td>
                  {conDescrizione && <td className={`${td} text-muted-foreground`}>{s.display_name && s.display_name !== s.name ? s.display_name : ""}</td>}
                  <td className={td}><EsitoServizioTesto s={s} /></td>
                  {!linux && <td className={td}>{s.start_mode ?? ""}</td>}
                </tr>
              ))}
              {filtrati.length === 0 && <tr><td className={`${td} text-muted-foreground`} colSpan={4}>Nessun servizio corrisponde a «{filtro}».</td></tr>}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <Riquadro titolo={`Porte in ascolto (${raggruppaPorte(porte).length})`} vuoto={porte.length === 0}>
        <TabellaPorte porte={porte} />
      </Riquadro>

      <Riquadro titolo={`Pianificazioni (${cron.length})`} vuoto={cron.length === 0}>
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-card"><tr><th className={th}>Utente</th><th className={th}>Quando</th><th className={th}>Comando</th></tr></thead>
            <tbody>
              {cron.map((c, i) => (
                <tr key={i}>
                  <td className={`${td} font-mono font-semibold`}>{c.user ?? "?"}</td>
                  <td className={`${td} whitespace-nowrap font-mono`}>{c.schedule ?? ""}</td>
                  <td className={`${td} font-mono`}><span className="block max-w-[48rem] truncate" title={c.command ?? ""}>{c.command ?? ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>
    </div>
  );
}
