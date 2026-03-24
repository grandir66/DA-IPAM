import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, getDeviceCredentials, syncInventoryFromDevice } from "@/lib/db";
import { ProxmoxClient, resolveProxmoxApiPortOverride, type ProxmoxHostInfo, type ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import { extractProxmoxViaSsh } from "@/lib/proxmox/proxmox-ssh";
import { mergeProxmoxExtractResults } from "@/lib/proxmox/proxmox-merge-results";
import {
  buildProxmoxApiUrlForIp,
  MAX_PROXMOX_SCAN_TARGETS,
  proxmoxSshUsername,
  resolveProxmoxTargetIps,
} from "@/lib/proxmox/proxmox-targets";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

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

    const scanTarget = (device as { scan_target?: string | null }).scan_target;
    const isProxmox =
      scanTarget === "proxmox" ||
      device.device_type === "hypervisor" ||
      (device.classification === "hypervisor" && (device.protocol === "api" || device.protocol === "ssh"));
    if (!isProxmox) {
      return NextResponse.json(
        { error: "Questo dispositivo non è configurato come Proxmox. Imposta 'Tipo di scansione' su Proxmox in Modifica." },
        { status: 400 }
      );
    }

    if (!device.enabled) {
      return NextResponse.json({ error: "Dispositivo disabilitato" }, { status: 400 });
    }

    // Legge credenziali dal sistema bindings (v2) con fallback su campi legacy
    const creds = getDeviceCredentials(device);
    if (!creds) {
      return NextResponse.json(
        { error: "Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password." },
        { status: 400 }
      );
    }
    const { username, password } = creds;

    const targets = resolveProxmoxTargetIps(device);
    if (targets.length === 0) {
      return NextResponse.json({ error: "Indica un host o IP valido (es. 192.168.40.1 o 192.168.40.1,2,3)." }, { status: 400 });
    }
    if (targets.length > MAX_PROXMOX_SCAN_TARGETS) {
      return NextResponse.json(
        { error: `Troppi indirizzi (${targets.length}). Massimo ${MAX_PROXMOX_SCAN_TARGETS}.` },
        { status: 400 }
      );
    }

    const apiUsername = username.includes("@") ? username : `${username}@pam`;
    const sshUsername = proxmoxSshUsername(username);

    const chunks: { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] }[] = [];
    const partialErrors: string[] = [];

    for (const ip of targets) {
      const apiUrl = buildProxmoxApiUrlForIp(ip, device.api_url);
      try {
        const port = resolveProxmoxApiPortOverride(apiUrl, device.port ?? undefined);
        const client = new ProxmoxClient({
          host: apiUrl,
          ...(port !== undefined ? { port } : {}),
          username: apiUsername,
          password,
          verifySsl: false,
        });
        chunks.push(
          await client.extractAll({
            includeStopped: false,
            includeContainers: true,
          })
        );
      } catch (e) {
        partialErrors.push(`API ${ip}: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        chunks.push(
          await extractProxmoxViaSsh(
            { host: ip, port: device.port ?? 22, username: sshUsername, password },
            { includeStopped: false, includeContainers: true }
          )
        );
      } catch (e) {
        partialErrors.push(`SSH ${ip}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const merged = mergeProxmoxExtractResults(chunks);
    if (merged.hosts.length === 0 && merged.vms.length === 0) {
      return NextResponse.json(
        {
          error:
            partialErrors.length > 0
              ? partialErrors.join(" | ")
              : "Nessun dato raccolto da API o SSH sui target indicati.",
        },
        { status: 500 }
      );
    }

    const result = {
      hosts: merged.hosts,
      vms: merged.vms,
      scanned_at: new Date().toISOString(),
      ...(partialErrors.length > 0 ? { avvisi: partialErrors } : {}),
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
});
}