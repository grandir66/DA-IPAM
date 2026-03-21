import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, deleteNetworkDevice, getArpEntriesByDevice, getMacPortEntriesByDevice, getSwitchPortsByDevice } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const PROXMOX_MAX_VMS = 500;

interface ProxmoxSummary {
  hosts: unknown[];
  vms: unknown[];
  scanned_at: string | null;
  avvisi?: string[];
  _truncated?: boolean;
  _total_vms?: number;
}

function parseProxmoxSummary(raw: string | null): ProxmoxSummary | null {
  if (!raw?.trim()) return null;
  try {
    const p = JSON.parse(raw) as {
      hosts?: unknown[];
      vms?: unknown[];
      scanned_at?: string;
      avvisi?: string[];
    };
    const allVms = p.vms ?? [];
    const capped = allVms.length > PROXMOX_MAX_VMS;
    return {
      hosts: p.hosts ?? [],
      vms: capped ? allVms.slice(0, PROXMOX_MAX_VMS) : allVms,
      scanned_at: p.scanned_at ?? null,
      avvisi: p.avvisi,
      ...(capped ? { _truncated: true, _total_vms: allVms.length } : {}),
    };
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const isHypervisor = device.device_type === "hypervisor" || device.scan_target === "proxmox";
    const arpEntries = device.device_type === "router" ? getArpEntriesByDevice(Number(id)) : [];
    const macPortEntries = device.device_type === "switch" ? getMacPortEntriesByDevice(Number(id)) : [];
    const switchPorts = isHypervisor ? [] : getSwitchPortsByDevice(Number(id));

    let stp_info: unknown = null;
    if (device.stp_info) {
      try {
        stp_info = JSON.parse(device.stp_info);
      } catch { /* invalid JSON */ }
    }

    let device_info: Record<string, unknown> | null = null;
    if (device.last_device_info_json) {
      try {
        const parsed = JSON.parse(device.last_device_info_json);
        if (typeof parsed === "object" && parsed !== null) {
          device_info = parsed as Record<string, unknown>;
          const normalizeWmiDate = (v: unknown): unknown => {
            if (typeof v !== "string") return v;
            const m = v.match(/\/Date\((\d+)\)\//);
            if (m) return new Date(Number(m[1])).toISOString();
            if (/^\d{14}/.test(v)) {
              return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:${v.slice(12,14)}`;
            }
            return v;
          };
          if (device_info.install_date) device_info.install_date = normalizeWmiDate(device_info.install_date);
          if (device_info.last_boot) device_info.last_boot = normalizeWmiDate(device_info.last_boot);
        }
      } catch { /* invalid JSON */ }
    }

    const proxmox_data = isHypervisor ? parseProxmoxSummary(device.last_proxmox_scan_result) : null;

    return NextResponse.json(
      {
        ...device,
        last_proxmox_scan_result: null,
        proxmox_data,
        encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
        community_string: device.community_string ? "●●●●●●●●" : null,
        api_token: device.api_token ? "●●●●●●●●" : null,
        stp_info,
        device_info,
        arp_entries: arpEntries,
        mac_port_entries: macPortEntries,
        switch_ports: switchPorts,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error("Error fetching device:", error);
    return NextResponse.json({ error: "Errore nel recupero del dispositivo" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.host !== undefined) updates.host = body.host;
    if (body.device_type !== undefined) updates.device_type = body.device_type;
    if (body.classification !== undefined) updates.classification = body.classification;
    if (body.vendor !== undefined) updates.vendor = body.vendor;
    if (body.vendor_subtype !== undefined) updates.vendor_subtype = body.vendor_subtype;
    if (body.protocol !== undefined) updates.protocol = body.protocol;
    if (body.credential_id !== undefined) updates.credential_id = body.credential_id;
    if (body.snmp_credential_id !== undefined) updates.snmp_credential_id = body.snmp_credential_id;
    if (body.username !== undefined) updates.username = body.username;
    if (body.password) updates.encrypted_password = encrypt(body.password);
    if (body.credential_id != null) {
      updates.username = null;
      updates.encrypted_password = null;
    }
    if (body.community_string) updates.community_string = encrypt(body.community_string);
    if (body.api_token) updates.api_token = encrypt(body.api_token);
    if (body.api_url !== undefined) updates.api_url = body.api_url;
    if (body.port !== undefined) updates.port = body.port;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.scan_target !== undefined) updates.scan_target = body.scan_target;

    const device = updateNetworkDevice(Number(id), updates as Partial<import("@/types").NetworkDevice>);
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    return NextResponse.json({
      ...device,
      last_proxmox_scan_result: null,
      encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
      community_string: device.community_string ? "●●●●●●●●" : null,
      api_token: device.api_token ? "●●●●●●●●" : null,
    });
  } catch (error) {
    console.error("Error updating device:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const deleted = deleteNetworkDevice(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting device:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
