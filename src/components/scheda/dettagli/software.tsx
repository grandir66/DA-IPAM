"use client";

/**
 * «Dettagli» > Software (spostato da `objects/[id]/page.tsx`, 21/10): inventario dall'agente GLPI e scansione remota.
 */
import { Badge } from "@/components/ui/badge";
import { HardDrive } from "lucide-react";
import { HostInventoryAgentCard } from "@/components/hosts/host-inventory-agent-card";
import { DeviceSoftwareCard } from "@/components/hosts/host-software-card";
import { Section } from "../blocchi";
import type { ContestoScheda } from "../contesto";

export function DettagliSoftware({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, isManaged, isWindowsOrLinux, isMacPlatform } = ctx;
  return (
    <div className="space-y-4">
      <Section icon={<HardDrive className="h-4 w-4" />} title="Software da GLPI Agent (push)">
        <HostInventoryAgentCard hostId={host.id} />
      </Section>


      {/* ─── 4. Software inventory (solo se device + windows/linux) ─── */}
      {isManaged && isWindowsOrLinux && device && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato (scansione remota)">
          <DeviceSoftwareCard deviceId={device.id} osHint={device.vendor as "windows" | "linux"} />
        </Section>
      )}
      {isManaged && isMacPlatform && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Scansione remota software">
          <p className="text-sm text-muted-foreground">
            Su macOS l&apos;elenco applicazioni proviene dal <strong>GLPI Agent</strong> (sezione sopra).
            WinRM/WMI e scan remoto non sono applicabili; installa o verifica l&apos;agent in Impostazioni → Moduli.
          </p>
        </Section>
      )}
      {isManaged && !isWindowsOrLinux && !isMacPlatform && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Inventario software non applicabile per vendor <Badge variant="outline">{device?.vendor}</Badge>.
            Disponibile per device <Badge variant="outline">windows</Badge>, <Badge variant="outline">linux</Badge> o{" "}
            <Badge variant="outline">apple</Badge> (via GLPI Agent).
          </p>
        </Section>
      )}
      {!isManaged && (host.classification === "server" || host.classification === "workstation") && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Per scansionare il software, promuovi prima questo host a device gestito da Discovery
            (selezione → &quot;Aggiungi a dispositivi&quot;).
          </p>
        </Section>
      )}
    </div>
  );
}
