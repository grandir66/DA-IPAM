"use client";

/**
 * Panoramica dell'hypervisor (artboard Hypervisor): striscia dei numeri, nodi in righe, storage più pieni e le
 * VM accese con l'abbinamento a IPAM. Deve stare in 1440×900 senza scorrere la pagina: nodi e storage a sinistra,
 * le VM a destra. Senza scansione ricade sulla panoramica generica.
 */
import { caselleHypervisor, filtraVm, numeroVm, poolStorage } from "@/lib/scheda/hypervisor";
import { parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFonti, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { PanoramicaGenerica } from "../../panoramica-generica";
import type { ContestoScheda } from "../../contesto";
import { lnk, pxDi, useAbbinamenti } from "./dati-hypervisor";
import { RigheNodi } from "./nodi";
import { ElencoPool } from "./storage";
import { TabellaVm } from "./vm";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const VM_IN_PANORAMICA = 8;

export function PanoramicaHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const px = pxDi(ctx);
  const ab = useAbbinamenti(ctx.device?.id);
  const pool = poolStorage(px);
  if (!px) return <PanoramicaGenerica ctx={ctx} />;

  const { apriTab } = ctx;
  const caselle = caselleHypervisor(px, { nodi: ab.nodi });
  const nodi = px.hosts ?? [];
  const vms = px.vms ?? [];
  const accese = filtraVm(vms, "accese", "");
  const quando = px.scanned_at ? breve(px.scanned_at) : undefined;
  const fonti: Fonte[] = [
    { nome: "Scansione Proxmox", esito: "ok", ...(quando ? { quando } : {}) },
    ab.stato === "ok" ? { nome: "IPAM", esito: "ok" } : { nome: "IPAM", esito: "assente", nota: ab.stato === "caricamento" ? "abbinamento in lettura" : "abbinamento non letto" },
  ];

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          <Riquadro titolo={`Nodi (${nodi.length})`} vuoto={nodi.length === 0} azione={<button type="button" onClick={() => apriTab("nodi")} className={lnk}>dettaglio ›</button>}>
            <RigheNodi ctx={ctx} nodi={nodi} ab={ab} />
          </Riquadro>
          <Riquadro titolo="Storage" vuoto={pool.length === 0} azione={<button type="button" onClick={() => apriTab("storage_px")} className={lnk}>tutti ({pool.length}) ›</button>}>
            <ElencoPool pool={pool} max={4} />
          </Riquadro>
        </div>
        <div className="min-w-0">
          <Riquadro titolo={`VM e container accesi (${accese.length} di ${numeroVm(px)})`} vuoto={vms.length === 0} azione={<button type="button" onClick={() => apriTab("vm")} className={lnk}>tutte ({numeroVm(px)}) ›</button>}>
            <TabellaVm vms={accese.slice(0, VM_IN_PANORAMICA)} ab={ab} compatta />
            {accese.length > VM_IN_PANORAMICA && (
              <p className="mt-2 text-[13px] text-muted-foreground">… altre {accese.length - VM_IN_PANORAMICA} · cerca per nome, IP o VLAN nella tab «VM e container»</p>
            )}
          </Riquadro>
        </div>
      </div>

      <RigaFonti fonti={fonti} />
    </div>
  );
}
