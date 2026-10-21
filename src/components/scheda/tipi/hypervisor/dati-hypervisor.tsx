"use client";

/**
 * Dati comuni alle tab dell'hypervisor: la scansione Proxmox dell'apparato e l'abbinamento con gli host di IPAM
 * (GET /api/devices/[id]/proxmox-match). L'abbinamento si legge a ogni tab che lo usa: è una query leggera.
 */
import { useEffect, useState } from "react";
import type { NodoAbbinato, VmAbbinata } from "@/lib/scheda/abbinamento-proxmox";
import type { ProxmoxScanViewModel } from "../../dati";
import type { ContestoScheda } from "../../contesto";

export const lnk = "text-[13px] font-semibold text-[#006C96] underline-offset-2 hover:underline dark:text-[#7FD3F5]";

export const pxDi = (ctx: ContestoScheda): ProxmoxScanViewModel | null => {
  const px = ctx.device?.proxmox_data ?? null;
  return px && ((px.hosts?.length ?? 0) > 0 || (px.vms?.length ?? 0) > 0) ? px : null;
};

export interface Abbinamenti {
  /** «caricamento»: ancora in corso; «errore»: la rotta non ha risposto (la tabella dice «non verificato», non «non trovata»). */
  stato: "caricamento" | "ok" | "errore";
  vm: Map<string, VmAbbinata>;
  nodi: NodoAbbinato[];
}

export const chiaveVm = (nodo: string, vmid: number): string => `${nodo}/${vmid}`;

export function useAbbinamenti(deviceId: number | undefined): Abbinamenti {
  const [r, setR] = useState<Abbinamenti>({ stato: "caricamento", vm: new Map(), nodi: [] });
  useEffect(() => {
    if (deviceId == null) return;
    let vivo = true;
    fetch(`/api/devices/${deviceId}/proxmox-match`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ vms: VmAbbinata[]; nodi: NodoAbbinato[] }>) : Promise.reject(new Error(String(res.status)))))
      .then((d) => { if (vivo) setR({ stato: "ok", vm: new Map(d.vms.map((v) => [chiaveVm(v.node, v.vmid), v])), nodi: d.nodi }); })
      .catch(() => { if (vivo) setR({ stato: "errore", vm: new Map(), nodi: [] }); });
    return () => { vivo = false; };
  }, [deviceId]);
  return r;
}

export function SenzaScansione() {
  return <p className="text-sm text-muted-foreground">Nessuna scansione Proxmox salvata per questo apparato: usa «Aggiorna» per leggerla.</p>;
}

/** Stato del nodo: quello di IPAM (la scansione scrive «unknown»); null = nessuno lo sa. */
export function statoNodo(nome: string, scanStato: string, ab: Abbinamenti): "online" | "offline" | null {
  const s = ab.nodi.find((n) => n.nodo === nome)?.stato ?? scanStato;
  return s === "online" || s === "offline" ? s : null;
}
