"use client";

/**
 * Tab «Sicurezza» (comune): vulnerabilità dell'host e, se c'è un agente, Wazuh (prima visibile solo in Discovery).
 * In fondo «Con chi parla», dai collector di traffico.
 * Wazuh e traffico si auto-nascondono senza dati: l'assenza si dice nella riga delle fonti della Panoramica.
 */
import { HostVulnerabilitiesCard } from "@/components/hosts/host-vulnerabilities-card";
import { HostWazuhCard } from "@/components/hosts/host-wazuh-card";
import { TrafficoHost } from "./traffico-host";
import type { ContestoScheda } from "./contesto";

export function TabSicurezza({ ctx }: { ctx: ContestoScheda }) {
  return (
    <div className="space-y-4">
      {/* La scheda ha già il suo titolo «Vulnerabilità»: niente riquadro sopra. */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <HostVulnerabilitiesCard hostId={ctx.host.id} />
      </div>
      <HostWazuhCard hostId={ctx.host.id} />
      <TrafficoHost ip={ctx.host.ip} />
    </div>
  );
}
