"use client";
/**
 * La tabella delle porte della Mappa porte, una riga per porta o aggregato: tipo, modo, VLAN, PoE, vicino, quanti MAC. La usano la
 * pagina `/port-map` e la scheda «Porte» degli hypervisor (Riccardo, 08/11: «gli hypervisor devono essere trattati come switch per
 * le porte»). Senza la colonna «Apparato» quando è la scheda di un apparato solo.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Etichetta } from "@/components/shared/console";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DatoVlan, ModoPorta, PortaMappa, TipoPorta } from "@/lib/mappa-porte/tipi";

export const TIPI_PORTA: Record<TipoPorta, string> = {
  passaggio: "Di passaggio", hypervisor: "Hypervisor", terminale: "Terminale", telefono_pc: "Telefono + PC", condivisa: "Condivisa", wifi: "Wifi", vuota: "Vuota",
};
export const MODI: Record<ModoPorta, string> = { accesso: "Accesso", trunk: "Trunk", non_letto: "Non letto" };
export const conDedotto = (testo: string, dato: DatoVlan) => (dato === "dedotto" ? `${testo} ≈` : testo);

/** Ordinamento dal server (le tabelle sono paginate): colonna, verso e chi lo cambia. Senza, le intestazioni non si cliccano. */
export interface OrdinamentoTabella { colonna: string | null; verso: SortDirection; onOrdina: (colonna: string) => void }

/** Intestazione ordinabile se c'è un ordinamento e la colonna ha un id; altrimenti un'intestazione normale. */
export function Testata({ id, ordine, className, children }: { id?: string; ordine?: OrdinamentoTabella; className?: string; children: ReactNode }) {
  if (!ordine || !id) return <TableHead className={className}>{children}</TableHead>;
  return <SortableTableHead columnId={id} sortColumn={ordine.colonna} sortDirection={ordine.verso} onSort={ordine.onOrdina} className={className}>{children}</SortableTableHead>;
}

export function TabellaPorte({ righe, conApparato = true, ordine }: { righe: PortaMappa[]; conApparato?: boolean; ordine?: OrdinamentoTabella }) {
  return (
    <Table fissa riserva={70}>
      <TableHeader>
        <TableRow>
          {conApparato && <Testata id="apparato" ordine={ordine}>Apparato</Testata>}
          <Testata id="porta" ordine={ordine}>Porta</Testata><Testata id="stato" ordine={ordine}>Stato</Testata><Testata id="tipo" ordine={ordine}>Tipo</Testata>
          <Testata id="modo" ordine={ordine}>Modo</Testata><Testata id="pvid" ordine={ordine}>PVID</Testata><Testata>Tagged</Testata>
          <Testata id="velocita" ordine={ordine}>Velocità</Testata><Testata id="poe" ordine={ordine}>PoE</Testata><Testata id="vicino" ordine={ordine}>Vicino</Testata>
          <Testata id="mac" ordine={ordine} className="text-right">MAC</Testata>
        </TableRow>
      </TableHeader>
      <TableBody>
        {righe.map((p) => (
          <TableRow key={`${p.deviceId}|${p.chiave}`}>
            {conApparato && <TableCell className="max-w-44 truncate"><Link href={`/devices/${p.deviceId}`} className="hover:underline">{p.apparato}</Link></TableCell>}
            <TableCell className="max-w-56 font-mono text-[13px] whitespace-normal">
              {p.nome}
              {p.membri.length > 0 && <span className="block text-muted-foreground">{p.membri.join(", ")}</span>}
              {p.stp === "blocking" && <span className={`ml-1 inline-flex rounded-md border px-1.5 py-0.5 text-[13px] leading-none font-semibold ${STILE_STATO.guasto.classi}`}>✕ STP bloccata</span>}
            </TableCell>
            <TableCell className="text-[13px]">{p.stato ?? "—"}</TableCell>
            <TableCell className="text-[13px]" title={p.motivi.join(", ") || undefined}>{TIPI_PORTA[p.tipo]}</TableCell>
            <TableCell>{p.modo === "trunk" ? <Etichetta tono="marca" mono={false}>{conDedotto(MODI.trunk, p.datoVlan)}</Etichetta> : <span className="text-[13px]">{conDedotto(MODI[p.modo], p.datoVlan)}</span>}</TableCell>
            <TableCell className="font-mono text-[13px]">{p.pvid ?? "—"}</TableCell>
            <TableCell className="max-w-40 truncate font-mono text-[13px]" title={p.vlanTagged.join(", ") || undefined}>{p.vlanTagged.join(", ") || "—"}</TableCell>
            <TableCell className="font-mono text-[13px] whitespace-nowrap">{p.velocita ?? "—"}</TableCell>
            <TableCell className="font-mono text-[13px] whitespace-nowrap">{p.poeStato ? `${p.poeStato}${p.poeMw != null ? ` ${(p.poeMw / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} W` : ""}` : <span className="font-sans text-muted-foreground">non letto</span>}</TableCell>
            <TableCell className="max-w-44 truncate text-[13px]" title={p.vicino ?? undefined}>{p.vicino ?? "—"}</TableCell>
            <TableCell className="text-right font-mono text-[13px]">{p.nMac}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
