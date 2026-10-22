import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import {
  getNetworkDeviceById,
  getHostByIp,
  getInventoryAssetByHost,
  createInventoryAsset,
  updateInventoryAsset,
} from "@/lib/db";
import type { ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { getHostNotoPerIp, getHostNotoPerNomeNodo } from "@/lib/db";
import { parseProxmoxScan } from "@/lib/topology/vms";
import { abbinaNodi, abbinaVm } from "@/lib/scheda/abbinamento-proxmox";

/**
 * GET: sola lettura, niente scritture (il POST sotto crea e aggiorna gli asset). Dice, per la scansione salvata
 * dell'apparato, quale host di IPAM è ogni VM e ogni nodo del cluster: serve alla scheda hypervisor.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const guardia = await requireAuth();
      if (isAuthError(guardia)) return guardia;
      const deviceId = parseInt((await params).id, 10);
      if (isNaN(deviceId)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
      const device = getNetworkDeviceById(deviceId);
      if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
      const { vms, hosts } = parseProxmoxScan(deviceId, device.last_proxmox_scan_result ?? null);
      const ricerche = { perIp: getHostNotoPerIp, perNome: getHostNotoPerNomeNodo };
      return NextResponse.json({ vms: abbinaVm(vms, ricerche), nodi: abbinaNodi(hosts, ricerche) });
    } catch (error) {
      console.error("Proxmox match (lettura) error:", error);
      return NextResponse.json({ error: "Errore nell'abbinamento con Proxmox" }, { status: 500 });
    }
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deviceId = parseInt(id, 10);
    if (isNaN(deviceId)) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const device = getNetworkDeviceById(deviceId);
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const lastResult = device.last_proxmox_scan_result;
    if (!lastResult) {
      return NextResponse.json(
        { error: "Esegui prima uno scan per ottenere i dati" },
        { status: 400 }
      );
    }

    let parsed: { hosts?: unknown[]; vms?: ProxmoxVM[] };
    try {
      parsed = JSON.parse(lastResult) as { hosts?: unknown[]; vms?: ProxmoxVM[] };
    } catch {
      return NextResponse.json({ error: "Dati scan non validi" }, { status: 400 });
    }

    const vms = parsed.vms ?? [];
    const matches: { ip: string; vm: ProxmoxVM; host_id: number; action: "created" | "updated" | "skipped" }[] = [];
    let created = 0;
    let updated = 0;

    for (const vm of vms) {
      for (const ip of vm.ip_addresses) {
        const host = getHostByIp(ip);
        if (!host) continue;

        const ramGb = Math.round(vm.memory_mb / 1024);
        const cpuStr = vm.cores && vm.sockets ? `${vm.cores} core × ${vm.sockets} socket` : `${vm.maxcpu} vCPU`;
        const storageGb = Math.round(vm.disk_gb);

        const inventoryUpdate = {
          hostname: vm.name,
          categoria: "VM" as const,
          cpu: cpuStr,
          ram_gb: ramGb,
          storage_gb: storageGb,
          storage_tipo: "SSD" as const,
          ip_address: ip,
          note_tecniche: `Proxmox ${vm.type.toUpperCase()} - Nodo: ${vm.node} - VMID: ${vm.vmid}`,
        };

        let asset = getInventoryAssetByHost(host.id);

        if (asset) {
          updateInventoryAsset(asset.id, inventoryUpdate);
          matches.push({ ip, vm, host_id: host.id, action: "updated" });
          updated++;
        } else {
          asset = createInventoryAsset({
            host_id: host.id,
            stato: "Attivo",
            ...inventoryUpdate,
          });
          matches.push({ ip, vm, host_id: host.id, action: "created" });
          created++;
        }
      }
    }

    return NextResponse.json({
      matches,
      created,
      updated,
      total_vms: vms.length,
      vms_with_ips: vms.filter((v) => v.ip_addresses.length > 0).length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore durante il match";
    console.error("Proxmox match error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
}