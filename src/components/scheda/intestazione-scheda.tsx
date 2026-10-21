"use client";

/**
 * Intestazione della scheda apparato, in una riga (artboard Main ①): indietro, nome, IP, tipo (pieno navy),
 * ruoli (bordo navy su bianco), stato con ms, «marca · modello · firmware» (o «VM n su <nodo>»), UN badge di
 * credenziale, e a destra le azioni. Il dato che manca non si rende (niente «—»).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BadgeSenzaProva } from "@/components/devices/credenziali-assegnate";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { ETICHETTE_RUOLI, type RuoloServer } from "@/lib/classification/canonico";
import { senzaCredenzialeProvata } from "@/lib/devices/credenziali-assegnate";
import type { TipoScheda } from "@/lib/scheda/tipo-scheda";
import { cn } from "@/lib/utils";
import type { HostDetail } from "@/types";
import type { DeviceFull } from "./dati";

export const ETICHETTA_TIPO: Record<TipoScheda, string> = {
  switch: "Switch",
  router: "Router",
  firewall: "Firewall",
  storage: "Storage",
  hypervisor: "Hypervisor",
  server_windows: "Server Windows",
  server_linux: "Server Linux",
  generico: "Apparato",
  host: "Host",
};

const PASTIGLIA = "inline-flex min-h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md border-2 px-2.5 py-0.5 text-[13px] font-semibold leading-tight";

/** «VM 105 su DA-PX-01» quando l'abbinamento con Proxmox c'è (lo fornisce la scheda dell'hypervisor, T6). */
export interface VmSu { vmid: number; nodo: string; href?: string }

const maiuscolaIniziale = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function IntestazioneScheda({
  host,
  device,
  tipo,
  ruoli,
  azioni,
  vmSu,
}: {
  host: HostDetail;
  device: DeviceFull | null;
  tipo: TipoScheda;
  ruoli: string[];
  azioni: ReactNode;
  vmSu?: VmSu | null;
}) {
  const router = useRouter();
  const nome = host.custom_name || host.hostname || host.dns_reverse || host.ip;
  const stato = host.status === "online" ? STILE_STATO.ok : host.status === "offline" ? STILE_STATO.guasto : STILE_STATO.da_verificare;
  const testoStato = host.status === "online" ? "online" : host.status === "offline" ? "offline" : "stato sconosciuto";

  const marca = device?.device_info?.manufacturer ?? host.device_manufacturer ?? (device?.vendor && device.vendor !== "other" ? maiuscolaIniziale(device.vendor) : null) ?? host.vendor;
  const identita = vmSu
    ? null
    : [marca, device?.model ?? host.model, device?.firmware ?? host.firmware].filter((v): v is string => !!v && v.trim() !== "").join(" · ");

  const provate = (host.host_credentials ?? []).filter((hc) => hc.validated === 1).length;
  const ruoliNoti = ruoli.filter((r): r is RuoloServer => r in ETICHETTE_RUOLI);

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      {/* Una riga da lg in su: nome e marca/modello si accorciano, pastiglie e azioni no. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="shrink-0" aria-label="Indietro" title="Indietro">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="min-w-0 shrink truncate text-xl font-bold tracking-tight" title={nome}>{nome}</h1>
        <span className="shrink-0 font-mono text-sm text-muted-foreground">{host.ip}</span>
        <span className={cn(PASTIGLIA, "shrink-0 border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]")}>{ETICHETTA_TIPO[tipo]}</span>
        {ruoliNoti.map((r) => (
          <span key={r} className={cn(PASTIGLIA, "shrink-0 border-[#0D2537] bg-white text-[#0D2537] dark:border-[#E6EEF4] dark:bg-transparent dark:text-[#E6EEF4]")}>{ETICHETTE_RUOLI[r]}</span>
        ))}
        <span className={cn(PASTIGLIA, "shrink-0", stato.classi)}>
          {stato.segno} {testoStato}
          {host.last_response_time_ms != null && host.status === "online" ? ` · ${host.last_response_time_ms} ms` : ""}
        </span>
        {vmSu ? (
          <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
            {vmSu.href ? <Link href={vmSu.href} className="underline underline-offset-2">VM {vmSu.vmid} su {vmSu.nodo}</Link> : `VM ${vmSu.vmid} su ${vmSu.nodo}`}
          </span>
        ) : identita ? (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={identita}>{identita}</span>
        ) : null}
        {device && (senzaCredenzialeProvata(provate)
          ? <span className="shrink-0"><BadgeSenzaProva /></span>
          : <span className={cn(PASTIGLIA, "shrink-0", STILE_STATO.ok.classi)}>{STILE_STATO.ok.segno} credenziale provata</span>)}
        <div className="ml-auto flex shrink-0 items-center gap-2">{azioni}</div>
      </div>
    </div>
  );
}
