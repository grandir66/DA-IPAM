"use client";

/**
 * Storage del cluster: una riga per storage (quelli condivisi — NFS, PBS, Ceph — contano una volta sola e si
 * leggono «cluster»; quelli locali una per nodo), ordinati dal più pieno, con la barra d'uso.
 */
import { poolStorage, type PoolStorage } from "@/lib/scheda/hypervisor";
import { BarraUso } from "../../barra-uso";
import { formatGb } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { pxDi, SenzaScansione } from "./dati-hypervisor";

/** Righe «nome · tipo/nodo · barra», per la Panoramica. */
export function ElencoPool({ pool, max }: { pool: PoolStorage[]; max?: number }) {
  return (
    <ul className="space-y-2">
      {pool.slice(0, max ?? pool.length).map((p) => (
        <li key={`${p.nome}|${p.nodo}`} className="grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-3 text-[13px]">
          <span className="min-w-0 truncate" title={`${p.nome} · ${p.nodo} · ${p.tipo}`}>
            <span className="font-semibold">{p.nome}</span>
            <span className="text-muted-foreground"> · {p.nodo} · {p.tipo}</span>
          </span>
          {p.percento != null ? <BarraUso percento={p.percento} etichetta={`${Math.round(p.percento)}%`} /> : <span className="text-muted-foreground">uso non letto</span>}
        </li>
      ))}
    </ul>
  );
}

export function StorageHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const px = pxDi(ctx);
  const pool = poolStorage(px);
  if (!px || pool.length === 0) return <SenzaScansione />;
  const th = "border-b-2 bg-muted/60 px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground";
  const td = "border-b px-2 py-1.5 align-middle text-[13px]";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse">
          <thead>
            <tr><th className={th}>Nome</th><th className={th}>Tipo</th><th className={th}>Nodo</th><th className={th}>Contenuto</th><th className={th}>Usato</th><th className={th}>Disponibile</th><th className={th}>Totale</th></tr>
          </thead>
          <tbody>
            {pool.map((p) => (
              <tr key={`${p.nome}|${p.nodo}`}>
                <td className={`${td} font-mono font-semibold`}>{p.nome}</td>
                <td className={td}>{p.tipo}</td>
                <td className={td}>{p.nodo}</td>
                <td className={`${td} text-muted-foreground`}>{p.contenuto ?? "—"}</td>
                <td className={`${td} w-56`}>
                  {p.percento != null ? <BarraUso percento={p.percento} etichetta={`${Math.round(p.percento)}% · ${formatGb(p.usatoGb)}`} /> : "—"}
                </td>
                <td className={`${td} tabular-nums`}>{formatGb(p.disponibileGb)}</td>
                <td className={`${td} tabular-nums`}>{formatGb(p.totaleGb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted-foreground">Lo storage condiviso fra i nodi (NFS, PBS, Ceph) compare una volta sola, come «cluster».</p>
    </div>
  );
}
