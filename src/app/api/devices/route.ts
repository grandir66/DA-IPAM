import { NextResponse } from "next/server";
import { getNetworkDevices, getRouters, getSwitches, getDevicesByClassificationOrLegacy, createNetworkDevice, getHostByIp, updateHost, ensureInventoryAssetForNetworkDevice } from "@/lib/db";
import { NetworkDeviceSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";
import {
  getDefaultProductProfileForVendor,
  suggestDeviceTypeFromProductProfile,
  scanTargetHintFromProductProfile,
  vendorSubtypeFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** Alias storage unificati (Synology, QNAP, nas generico → storage) */
const STORAGE_ALIASES = ["nas", "nas_synology", "nas_qnap"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as "router" | "switch" | null;
    const rawClassification = searchParams.get("classification");
    const classification = rawClassification && STORAGE_ALIASES.includes(rawClassification) ? "storage" : rawClassification;

    if (classification) {
      const networkDevices = getDevicesByClassificationOrLegacy(classification);
      const maskedDevices = networkDevices.map((d) => ({
        ...d,
        source: "network_device" as const,
        last_proxmox_scan_result: d.last_proxmox_scan_result ? "HAS_DATA" : null,
        encrypted_password: d.encrypted_password ? "●●●●●●●●" : null,
        community_string: d.community_string ? "●●●●●●●●" : null,
        api_token: d.api_token ? "●●●●●●●●" : null,
      }));
      return NextResponse.json(maskedDevices, { headers: NO_CACHE_HEADERS });
    }

    const devices = type === "router"
      ? getRouters()
      : type === "switch"
        ? getSwitches()
        : getNetworkDevices();
    const masked = devices.map((d) => ({
      ...d,
      source: "network_device" as const,
      last_proxmox_scan_result: d.last_proxmox_scan_result ? "HAS_DATA" : null,
      encrypted_password: d.encrypted_password ? "●●●●●●●●" : null,
      community_string: d.community_string ? "●●●●●●●●" : null,
      api_token: d.api_token ? "●●●●●●●●" : null,
    }));
    return NextResponse.json(masked, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching devices:", error);
    return NextResponse.json({ error: "Errore nel recupero dei dispositivi" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = NetworkDeviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const productProfile = (data.product_profile ?? getDefaultProductProfileForVendor(data.vendor)) as ProductProfileId;
    const deviceType = suggestDeviceTypeFromProductProfile(productProfile);
    const deviceClassification =
      data.classification ??
      (deviceType === "router" ? "router" : deviceType === "switch" ? "switch" : "hypervisor");
    const defaultPort =
      data.protocol === "ssh" ? 22 : data.protocol === "api" ? (deviceType === "hypervisor" ? 8006 : 443) : data.protocol === "winrm" ? 5985 : 161;
    const scanTarget =
      data.scan_target ?? scanTargetHintFromProductProfile(productProfile);
    const device = createNetworkDevice({
      name: data.name,
      host: data.host,
      device_type: deviceType,
      classification: deviceClassification,
      vendor: data.vendor,
      vendor_subtype: data.vendor_subtype ?? vendorSubtypeFromProductProfile(productProfile),
      protocol: data.protocol,
      credential_id: data.credential_id ?? null,
      snmp_credential_id: data.snmp_credential_id ?? null,
      username: data.credential_id ? null : (data.username || null),
      encrypted_password: data.credential_id ? null : (data.password ? encrypt(data.password) : null),
      community_string: data.community_string ? encrypt(data.community_string) : null,
      api_token: data.api_token ? encrypt(data.api_token) : null,
      api_url: data.api_url || null,
      port: data.port || defaultPort,
      enabled: 1,
      scan_target: scanTarget,
      product_profile: productProfile,
    });

    const host = getHostByIp(data.host);
    if (host) updateHost(host.id, { classification: deviceClassification });

    ensureInventoryAssetForNetworkDevice(device);

    return NextResponse.json({
      ...device,
      encrypted_password: device.encrypted_password ? "●●●●●●●●" : null,
      community_string: device.community_string ? "●●●●●●●●" : null,
      api_token: device.api_token ? "●●●●●●●●" : null,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating device:", error);
    return NextResponse.json({ error: "Errore nella creazione del dispositivo" }, { status: 500 });
  }
}
