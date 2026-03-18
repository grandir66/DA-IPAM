import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, getCredentialById, syncInventoryFromDevice } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { ProxmoxClient } from "@/lib/proxmox/proxmox-client";
import { extractProxmoxViaSsh } from "@/lib/proxmox/proxmox-ssh";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const scanTarget = (device as { scan_target?: string | null }).scan_target;
    const isProxmox = scanTarget === "proxmox" || device.device_type === "hypervisor" || (device.classification === "hypervisor" && (device.protocol === "api" || device.protocol === "ssh"));
    if (!isProxmox) {
      return NextResponse.json({ error: "Questo dispositivo non è configurato come Proxmox. Imposta 'Tipo di scansione' su Proxmox in Modifica." }, { status: 400 });
    }

    if (!device.enabled) {
      return NextResponse.json({ error: "Dispositivo disabilitato" }, { status: 400 });
    }

    let username = "root";
    let password = "";

    if (device.credential_id) {
      const cred = getCredentialById(device.credential_id);
      if (cred) {
        if (cred.encrypted_username) {
          try {
            username = decrypt(cred.encrypted_username);
          } catch {
            return NextResponse.json({ error: "Impossibile decifrare username" }, { status: 500 });
          }
        }
        if (cred.encrypted_password) {
          try {
            password = decrypt(cred.encrypted_password);
          } catch {
            return NextResponse.json({ error: "Impossibile decifrare password" }, { status: 500 });
          }
        }
      }
    }

    if (!password) {
      return NextResponse.json(
        { error: "Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password." },
        { status: 400 }
      );
    }

    const host = (device.api_url?.trim() || device.host).replace(/^https?:\/\//i, "").split(":")[0];

    let hosts: Awaited<ReturnType<typeof import("@/lib/proxmox/proxmox-client").ProxmoxClient.prototype.extractAll>>["hosts"];
    let vms: Awaited<ReturnType<typeof import("@/lib/proxmox/proxmox-client").ProxmoxClient.prototype.extractAll>>["vms"];

    if (device.protocol === "ssh") {
      const result = await extractProxmoxViaSsh(
        { host, port: device.port ?? 22, username, password },
        { includeStopped: false, includeContainers: true }
      );
      hosts = result.hosts;
      vms = result.vms;
    } else {
      if (username && !username.includes("@")) username = `${username}@pam`;
      const hostOrUrl = device.api_url?.trim() || device.host;
      const port = device.port || 8006;
      const client = new ProxmoxClient({
        host: hostOrUrl,
        port,
        username,
        password,
        verifySsl: false,
      });
      const result = await client.extractAll({
        includeStopped: false,
        includeContainers: true,
      });
      hosts = result.hosts;
      vms = result.vms;
    }

    const result = {
      hosts,
      vms,
      scanned_at: new Date().toISOString(),
    };

    const updatedDevice = { ...device, last_proxmox_scan_at: result.scanned_at, last_proxmox_scan_result: JSON.stringify(result) };
    updateNetworkDevice(deviceId, {
      last_proxmox_scan_at: result.scanned_at,
      last_proxmox_scan_result: JSON.stringify(result),
    });
    syncInventoryFromDevice(updatedDevice as typeof device & { last_proxmox_scan_result: string });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore durante lo scan";
    console.error("Proxmox scan error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
