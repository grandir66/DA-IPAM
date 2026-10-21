"use client";

/**
 * Tab «Volumi»: volumi (QNAP) e pool (Synology) con la barra d'uso, gruppi RAID, I/O per volume (`volume_io`) e
 * il segnale dei pool estesi QTS 5 (`qts5_pool_rows`): prima stavano solo in /devices.
 */
import { formattaBps, formattaGb, gruppiRaidNas, poolNas, volumiNas, type VoceSpazio } from "@/lib/scheda/nas";
import { BarraUso } from "../../barra-uso";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { SenzaInventario, StatoNas, nasDi } from "./dati-nas";

/** Righe «nome · stato · barra d'uso», usate anche dalla Panoramica. */
export function ElencoSpazio({ voci, max }: { voci: VoceSpazio[]; max?: number }) {
  return (
    <ul className="space-y-2">
      {voci.slice(0, max ?? voci.length).map((v) => (
        <li key={v.nome} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3 text-[13px]">
          <span className="min-w-0">
            <span className="block truncate font-semibold" title={v.nome}>{v.nome}</span>
            {(v.raid || (v.stato && !v.stato.ok)) && (
              <span className="block truncate text-muted-foreground">
                {v.raid}{v.raid && v.stato && !v.stato.ok ? " · " : ""}{v.stato && !v.stato.ok ? <StatoNas ok={false} testo={v.stato.testo} /> : null}
              </span>
            )}
          </span>
          {v.percento != null && v.totaleGb != null && v.usatoGb != null
            ? <BarraUso percento={v.percento} etichetta={`${Math.round(v.percento)}% · ${formattaGb(v.usatoGb)}/${formattaGb(v.totaleGb)}`} />
            : <span className="text-muted-foreground">{v.totaleGb != null ? `${formattaGb(v.totaleGb)} (usato non letto)` : "dimensione non letta"}</span>}
        </li>
      ))}
    </ul>
  );
}

export function VolumiNas({ ctx }: { ctx: ContestoScheda }) {
  const nas = nasDi(ctx);
  if (!nas) return <SenzaInventario />;
  const volumi = volumiNas(nas);
  const pool = poolNas(nas);
  // I gruppi RAID descrivono gli stessi dischi dei pool: si mostrano qui solo se il pool non c'è (il resto sta in «Dischi e RAID»).
  const gruppi = pool.length > 0 ? [] : gruppiRaidNas(nas);
  const io = nas.snmp?.volume_io ?? [];
  const qts5 = nas.snmp?.qts5_pool_rows ?? 0;
  if (volumi.length + pool.length + gruppi.length + io.length === 0 && qts5 === 0) {
    return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nessun volume o pool letto dall&apos;apparato.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo={`Volumi (${volumi.length})`} vuoto={volumi.length === 0}><ElencoSpazio voci={volumi} /></Riquadro>
        <Riquadro titolo={`Pool di archiviazione (${pool.length})`} vuoto={pool.length === 0}><ElencoSpazio voci={pool} /></Riquadro>
        <Riquadro titolo={`Gruppi RAID (${gruppi.length})`} vuoto={gruppi.length === 0}><ElencoSpazio voci={gruppi} /></Riquadro>
        <Riquadro titolo="I/O per volume" vuoto={io.length === 0}>
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr>{["Volume", "Lettura", "Scrittura"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>)}</tr>
              </thead>
              <tbody>
                {io.map((x, i) => (
                  <tr key={`${x.name}-${i}`} className="border-b">
                    <td className="px-3 py-1.5 font-semibold">{x.name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{formattaBps(x.read_bps)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{formattaBps(x.write_bps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Riquadro>
      </div>
      {qts5 > 0 && (
        <p className="text-[13px] text-muted-foreground">
          QNAP: rilevati dati MIB QTS 5.x (pool estesi, {qts5} varbind). Non sono ancora interpretati: i pool qui sopra non li includono.
        </p>
      )}
    </div>
  );
}
