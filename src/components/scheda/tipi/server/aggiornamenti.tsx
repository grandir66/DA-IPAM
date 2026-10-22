"use client";

/**
 * Tab «Aggiornamenti» (Windows) e «Pacchetti» (Linux).
 * Windows: aggiornamenti mancanti e hotfix installati (prima in Dettagli > Sistema > «Aggiornamenti Windows»),
 * con il rimando a Patch management. Linux: numero di pacchetti e da aggiornare, e l'inventario software
 * (agente GLPI e scansione remota), che per Linux era nella sotto-tab Software.
 */
import { ultimoHotfix } from "@/lib/scheda/server";
import { Campo } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { DettagliSoftware } from "../../dettagli/software";
import { Riquadro } from "../../riquadro";
import { LinkPatch, Nessun, infoDi, td, th } from "./dati-server";

/** Hotfix dal più recente: id, descrizione, data. */
export function TabellaHotfix({ hotfix, max }: { hotfix: NonNullable<ReturnType<typeof infoDi>>["installed_hotfixes"]; max?: number }) {
  const ordinati = [...(hotfix ?? [])].sort((a, b) => (Date.parse(b.installed_on ?? "") || 0) - (Date.parse(a.installed_on ?? "") || 0));
  const mostrati = ordinati.slice(0, max ?? ordinati.length);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Aggiornamento</th><th className={th}>Tipo</th><th className={th}>Installato il</th></tr></thead>
        <tbody>
          {mostrati.map((h, i) => (
            <tr key={`${h.id}-${i}`}>
              <td className={`${td} font-mono font-semibold`}>{h.id ?? "?"}</td>
              <td className={td}>{h.description ?? ""}</td>
              <td className={td}>{h.installed_on ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ordinati.length > mostrati.length && <p className="mt-1 text-[13px] text-muted-foreground">… altri {ordinati.length - mostrati.length}</p>}
    </div>
  );
}

export function AggiornamentiServer({ ctx }: { ctx: ContestoScheda }) {
  const di = infoDi(ctx);
  if (ctx.tipo === "server_linux") {
    const ha = di?.packages_count != null || di?.pending_updates_count != null;
    return (
      <div className="space-y-4">
        <Riquadro titolo="Pacchetti" vuoto={!ha}>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Campo label="Installati" value={di?.packages_count != null ? String(di.packages_count) : null} />
            <Campo label="Da aggiornare" value={di?.pending_updates_count != null ? String(di.pending_updates_count) : null} />
          </dl>
          {di?.pending_updates_count == null && <p className="mt-3 text-[13px] text-muted-foreground">I pacchetti da aggiornare non sono letti dalla scansione: il conteggio degli installati è tutto ciò che c&apos;è.</p>}
        </Riquadro>
        <DettagliSoftware ctx={ctx} />
      </div>
    );
  }

  const hf = di?.installed_hotfixes ?? [];
  const pending = di?.pending_updates_count ?? null;
  const ultimo = ultimoHotfix(hf, new Date());
  if (hf.length === 0 && pending == null) {
    return (
      <div className="space-y-4">
        <Nessun>La scansione non ha letto gli aggiornamenti di Windows: usa «Aggiorna» per leggerli.</Nessun>
        <LinkPatch hostId={ctx.hostId} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Riquadro titolo="Stato" azione={<LinkPatch hostId={ctx.hostId} />}>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Campo label="Mancanti">{pending == null ? "non letto" : <span className={pending > 0 ? "font-semibold" : ""}>{pending > 0 && <span aria-hidden>▲ </span>}{pending}</span>}</Campo>
          <Campo label="Installati (letti)" value={String(hf.length)} />
          <Campo label="Ultimo installato" value={ultimo ? `${ultimo.id} · ${ultimo.giorni} g fa` : null} />
        </dl>
      </Riquadro>
      <Riquadro titolo={`Aggiornamenti installati (${hf.length})`} vuoto={hf.length === 0}>
        <TabellaHotfix hotfix={hf} />
      </Riquadro>
    </div>
  );
}
