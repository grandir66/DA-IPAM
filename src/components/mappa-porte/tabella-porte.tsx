"use client";
/**
 * La tabella delle porte della Mappa porte, una riga per porta o aggregato: tipo, modo, VLAN, PoE, vicino, quanti MAC. La usano la
 * pagina `/port-map` e la scheda «Porte» degli hypervisor (Riccardo, 08/11: «gli hypervisor devono essere trattati come switch per
 * le porte»). Senza la colonna «Apparato» quando è la scheda di un apparato solo.
 */
import Link from "next/link";
import { Etichetta } from "@/components/shared/console";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DatoVlan, ModoPorta, PortaMappa, TipoPorta } from "@/lib/mappa-porte/tipi";

export const TIPI_PORTA: Record<TipoPorta, string> = {
  passaggio: "Di passaggio", hypervisor: "Hypervisor", terminale: "Terminale", telefono_pc: "Telefono + PC", condivisa: "Condivisa", wifi: "Wifi", vuota: "Vuota",
};
export const MODI: Record<ModoPorta, string> = { accesso: "Accesso", trunk: "Trunk", non_letto: "Non letto" };
export const conDedotto = (testo: string, dato: DatoVlan) => (dato === "dedotto" ? `${testo} ≈` : testo);

export function TabellaPorte({ righe, conApparato = true }: { righe: PortaMappa[]; conApparato?: boolean }) {
  return (
    <Table fissa riserva={70}>
      <TableHeader>
        <TableRow>{conApparato && <TableHead>Apparato</TableHead>}<TableHead>Porta</TableHead><TableHead>Stato</TableHead><TableHead>Tipo</TableHead><TableHead>Modo</TableHead><TableHead>PVID</TableHead><TableHead>Tagged</TableHead><TableHead>Velocità</TableHead><TableHead>PoE</TableHead><TableHead>Vicino</TableHead><TableHead className="text-right">MAC</TableHead></TableRow>
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
