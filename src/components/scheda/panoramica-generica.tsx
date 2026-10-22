"use client";

/**
 * Panoramica degli apparati che non hanno (ancora) la loro: `host` (scoperto in Discovery, non gestito),
 * `generico` e, finché il suo task non è fatto, ogni altro tipo. Striscia dei numeri solo da dati che esistono,
 * poi porte aperte (qui UNA volta sola), rete e hardware se ci sono; in fondo da dove arrivano i dati.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { HostMeshcentralCard } from "@/components/hosts/host-meshcentral-card";
import { MobileProfilePanel } from "@/components/mobile/MobileProfilePanel";
import { accesoDa, casellePanoramicaGenerica } from "@/lib/scheda/panoramica";
import type { HostDetail } from "@/types";
import { Campo, parseUtcDate } from "./blocchi";
import { Riquadro } from "./riquadro";
import { RigaFontiScheda, type Fonte } from "./riga-fonti";
import { StrisciaNumeri } from "./striscia-numeri";
import type { ContestoScheda } from "./contesto";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaGenerica({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, librenms, tipo, runtimeSummary, apriTab, displayName } = ctx;
  const { tcpPorts, udpPorts } = runtimeSummary;
  const di = device?.device_info ?? null;

  const caselle = casellePanoramicaGenerica({
    stato: host.status,
    ms: host.last_response_time_ms ?? null,
    tcp: tcpPorts,
    udp: udpPorts,
    acceso: accesoDa(di),
  });

  const multihomed = (host as HostDetail & {
    multihomed?: { match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
  }).multihomed;
  const peers = multihomed?.peers ?? [];
  const haRete = !!(host.network_name || host.switch_port || host.arp_source || peers.length > 0);
  const haHardware = !!(di && (di.cpu_model || di.ram_total_gb || di.ram_total_mb));

  const fonti: Fonte[] = [];
  if (host.last_seen) fonti.push({ nome: "Discovery", esito: "ok", quando: breve(host.last_seen) });
  if (device) {
    fonti.push(di?.scanned_at
      ? { nome: "Scansione apparato", esito: "ok", quando: breve(di.scanned_at) }
      : { nome: "Scansione apparato", esito: "assente", nota: "mai eseguita" });
  }
  if (librenms?.configured) {
    fonti.push(librenms.mapped
      ? { nome: "LibreNMS", esito: "ok", ...(librenms.lastSyncedAt ? { quando: breve(librenms.lastSyncedAt) } : {}) }
      : { nome: "LibreNMS", esito: "non_abbinato" });
  }

  return (
    <div className="space-y-4">
      {/* Controllo remoto e profilo MDM: si auto-nascondono. Con un apparato gestito il controllo remoto sta in Gestione. */}
      {!device && <HostMeshcentralCard hostId={host.id} hostLabel={displayName} />}
      {(tipo === "host" || tipo === "generico") && <MobileProfilePanel hostId={host.id} />}

      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Riquadro titolo={`Porte aperte${tcpPorts.length > 0 ? ` (${tcpPorts.length})` : ""}`} vuoto={tcpPorts.length === 0 && udpPorts.length === 0}>
          <div className="space-y-3">
            {tcpPorts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] font-semibold text-muted-foreground">TCP</span>
                {tcpPorts.slice(0, 40).map((p) => (
                  <Badge key={`tcp-${p}`} variant="outline" className="font-mono text-[13px]">{p}</Badge>
                ))}
                {tcpPorts.length > 40 && <span className="text-[13px] text-muted-foreground">+{tcpPorts.length - 40}</span>}
              </div>
            )}
            {udpPorts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] font-semibold text-muted-foreground">UDP</span>
                {udpPorts.slice(0, 40).map((p) => (
                  <Badge key={`udp-${p}`} variant="secondary" className="font-mono text-[13px]">{p}</Badge>
                ))}
                {udpPorts.length > 40 && <span className="text-[13px] text-muted-foreground">+{udpPorts.length - 40}</span>}
              </div>
            )}
          </div>
        </Riquadro>

        <Riquadro titolo="Rete" vuoto={!haRete}>
          <dl className="grid grid-cols-2 gap-4">
            <Campo label="Subnet" value={host.network_name ? `${host.network_name} (${host.network_cidr})` : null} />
            <Campo label="VLAN" value={host.switch_port?.vlan ? String(host.switch_port.vlan) : null} />
            <Campo label="Porta dello switch" value={host.switch_port ? `${host.switch_port.device_name} · ${host.switch_port.port_name}` : null} />
            <Campo label="Visto dal router" value={host.arp_source ? `${host.arp_source.device_name} (${host.arp_source.device_vendor})` : null} />
          </dl>
          {peers.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1.5 text-[13px] font-semibold text-muted-foreground">
                Stesso apparato su altre reti ({peers.length + 1} interfacce) · riconosciuto da {multihomed?.match_type}
              </div>
              <div className="flex flex-wrap gap-2">
                {peers.map((p) => (
                  <Link key={p.host_id} href={`/objects/${p.host_id}`} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[13px] hover:bg-muted/50">
                    <span className="font-mono">{p.ip}</span>
                    <span className="text-muted-foreground">· {p.network_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Riquadro>

        <Riquadro titolo="Hardware" vuoto={!haHardware}>
          <dl className="grid grid-cols-2 gap-4">
            <Campo label="CPU" value={di?.cpu_model} />
            <Campo label="Core / thread" value={di?.cpu_cores != null ? `${di.cpu_cores}${di.cpu_threads ? ` / ${di.cpu_threads}` : ""}` : null} />
            <Campo label="RAM" value={di?.ram_total_gb != null ? `${di.ram_total_gb} GB` : di?.ram_total_mb ? `${di.ram_total_mb} MB` : null} />
          </dl>
        </Riquadro>
      </div>

      <RigaFontiScheda ctx={ctx} fonti={fonti} />
    </div>
  );
}
