import { NextResponse } from "next/server";
import {
  createNetworkDevice,
  getHostBasic,
  getNetworkDeviceByHost,
  getNetworkDeviceById,
  getCredentialCommunityString,
  updateHost,
  updateNetworkDevice,
  ensureInventoryAssetForNetworkDevice,
} from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { inferNetworkDeviceVendorFromHostHint } from "@/lib/device-vendor-infer";
import type { NetworkDevice } from "@/types";
import {
  getDefaultProductProfileForVendor,
  PRODUCT_PROFILE_IDS,
  suggestDeviceTypeFromProductProfile,
  vendorSubtypeFromProductProfile,
  scanTargetHintFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";

const productProfileEnum = z.enum(PRODUCT_PROFILE_IDS as unknown as [string, ...string[]]);

const classificationSchema = z.enum(DEVICE_CLASSIFICATIONS as unknown as [string, ...string[]]);

const BulkUpdateSchema = z.object({
  device_ids: z.array(z.coerce.number().int().positive()).optional(),
  host_ids: z.array(z.coerce.number().int().positive()).optional(),
  classification: classificationSchema.optional(),
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]).optional(),
  vendor: z.enum(["mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield", "proxmox", "vmware", "linux", "windows", "synology", "qnap", "other"]).optional(),
  vendor_subtype: z.enum(["procurve", "comware"]).optional().nullable(),
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  snmp_credential_id: z.coerce.number().int().positive().optional().nullable(),
}).refine(
  (d) => (d.device_ids?.length ?? 0) + (d.host_ids?.length ?? 0) > 0,
  { message: "Specificare almeno device_ids o host_ids" }
).refine(
  (d) =>
    d.classification !== undefined ||
    d.protocol !== undefined ||
    d.vendor !== undefined ||
    d.vendor_subtype !== undefined ||
    "credential_id" in d ||
    "snmp_credential_id" in d,
  { message: "Specificare almeno un campo da aggiornare" }
);

const BulkDeviceSchema = z.object({
  host_ids: z.array(z.coerce.number().int().positive()),
  classification: classificationSchema,
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]),
  vendor: z.enum(["mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield", "proxmox", "vmware", "linux", "windows", "synology", "qnap", "other"]).optional(),
  vendor_subtype: z.enum(["procurve", "comware"]).optional().nullable(),
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  snmp_credential_id: z.coerce.number().int().positive().optional().nullable(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  scan_target: z.enum(["proxmox", "vmware", "windows", "linux"]).optional().nullable(),
  product_profile: productProfileEnum.optional().nullable(),
});

/**
 * Crea più network_devices da host selezionati.
 * POST /api/devices/bulk
 * Body: { host_ids, device_type, vendor, protocol, credential_id?, community_string?, vendor_subtype?, port? }
 */
export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = BulkDeviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }

    const { host_ids, classification, vendor, protocol, credential_id, snmp_credential_id, port, scan_target, product_profile } =
      parsed.data;

    const hasCred = credential_id && credential_id > 0;
    let communityString: string | null = null;
    let snmpCredWarning = false;
    if (snmp_credential_id && snmp_credential_id > 0 && (protocol === "snmp_v2" || protocol === "snmp_v3")) {
      communityString = getCredentialCommunityString(snmp_credential_id);
      if (!communityString) {
        snmpCredWarning = true;
        communityString = null;
      }
    }
    const hasSnmpCred = !!communityString;

    /** Prima: vendor dal form; poi: inferenza da OUI/MAC host; infine: default per protocollo.
     *  Prima SNMP forzava sempre "other" e l'UI non inviava vendor → Ubiquiti/Cisco persi. */
    function resolveVendorForHost(hostRow: NonNullable<ReturnType<typeof getHostBasic>>): NetworkDevice["vendor"] {
      if (vendor) return vendor;
      const fromHost = inferNetworkDeviceVendorFromHostHint(hostRow.vendor ?? hostRow.device_manufacturer);
      if (fromHost) return fromHost;
      if (protocol === "winrm") return "windows";
      return "other";
    }

    const defaultPort = protocol === "ssh" ? 22 : protocol === "api" ? 443 : protocol === "winrm" ? 5985 : 161;
    const devicePort = port ?? defaultPort;

    const created: { id: number; name: string; host: string }[] = [];
    const skipped: { host: string; reason: string }[] = [];

    for (const hostId of host_ids) {
      const host = getHostBasic(hostId);
      if (!host) {
        skipped.push({ host: String(hostId), reason: "Host non trovato" });
        continue;
      }

      if (getNetworkDeviceByHost(host.ip)) {
        skipped.push({ host: host.ip, reason: "Già presente come dispositivo" });
        continue;
      }

      const name = host.custom_name || host.hostname || host.ip;
      const deviceVendor = resolveVendorForHost(host);
      const profileId = (product_profile ?? getDefaultProductProfileForVendor(deviceVendor)) as ProductProfileId;
      const deviceType = suggestDeviceTypeFromProductProfile(profileId);
      const device = createNetworkDevice({
        name,
        host: host.ip,
        device_type: deviceType,
        vendor: deviceVendor,
        vendor_subtype: vendorSubtypeFromProductProfile(profileId),
        credential_id: (hasCred || (protocol === "winrm" && credential_id)) ? credential_id : (hasSnmpCred && snmp_credential_id ? snmp_credential_id : null),
        protocol,
        snmp_credential_id: hasCred && hasSnmpCred && snmp_credential_id ? snmp_credential_id : null,
        username: null,
        encrypted_password: null,
        community_string: hasSnmpCred && communityString ? encrypt(communityString) : null,
        api_token: null,
        api_url: null,
        port: devicePort,
        enabled: 1,
        classification,
        scan_target: scan_target ?? scanTargetHintFromProductProfile(profileId) ?? null,
        product_profile: profileId,
      });

      created.push({ id: device.id, name: device.name, host: device.host });
      updateHost(host.id, { classification });
      ensureInventoryAssetForNetworkDevice(device);
    }

    let message = `${created.length} dispositivo${created.length !== 1 ? "i" : ""} aggiunto${created.length !== 1 ? "i" : ""}${skipped.length > 0 ? `, ${skipped.length} saltati` : ""}`;
    if (snmpCredWarning) {
      message += ". Credenziale SNMP ignorata (verifica in Credenziali: tipo SNMP e community string nel campo password).";
    }
    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      devices: created,
      skipped_list: skipped,
      message,
    });
  } catch (error) {
    console.error("Bulk add devices error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nell'aggiunta" },
      { status: 500 }
    );
  }
}

/**
 * Aggiorna in blocco dispositivi e/o host (classificazione, protocollo, credenziali).
 * PATCH /api/devices/bulk
 * Body: { device_ids?, host_ids?, classification?, protocol?, vendor?, credential_id?, snmp_credential_id?, vendor_subtype? }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parsed = BulkUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }

    const { device_ids = [], host_ids = [], classification, protocol, vendor, vendor_subtype, credential_id, snmp_credential_id } = parsed.data;

    let communityString: string | null = null;
    if (snmp_credential_id != null && snmp_credential_id > 0 && protocol && (protocol === "snmp_v2" || protocol === "snmp_v3")) {
      communityString = getCredentialCommunityString(snmp_credential_id);
    }

    const deviceVendor = protocol && (protocol === "ssh" || protocol === "api" || protocol === "winrm")
      ? (vendor ?? (protocol === "winrm" ? "windows" : "other"))
      : vendor;

    let devicesUpdated = 0;
    let hostsUpdated = 0;

    for (const id of device_ids) {
      const device = getNetworkDeviceById(id);
      if (!device) continue;

      const updates: Record<string, unknown> = {};
      if (classification !== undefined) updates.classification = classification;
      if (protocol !== undefined) updates.protocol = protocol;
      if (deviceVendor !== undefined) updates.vendor = deviceVendor;
      if (vendor_subtype !== undefined) updates.vendor_subtype = vendor_subtype;
      if ("credential_id" in parsed.data) {
        updates.credential_id = credential_id;
        if (credential_id != null && credential_id > 0) {
          updates.username = null;
          updates.encrypted_password = null;
        } else if (credential_id === null) {
          updates.username = null;
          updates.encrypted_password = null;
        }
      }
      if ("snmp_credential_id" in parsed.data) updates.snmp_credential_id = snmp_credential_id;
      if (communityString && (protocol === "snmp_v2" || protocol === "snmp_v3")) {
        updates.community_string = encrypt(communityString);
      }

      if (Object.keys(updates).length > 0) {
        updateNetworkDevice(id, updates as Parameters<typeof updateNetworkDevice>[1]);
        devicesUpdated++;
      }
    }

    for (const id of host_ids) {
      const host = getHostBasic(id);
      if (!host) continue;

      if (classification !== undefined) {
        updateHost(id, { classification });
        hostsUpdated++;
      }
    }

    const total = devicesUpdated + hostsUpdated;
    return NextResponse.json({
      success: true,
      devices_updated: devicesUpdated,
      hosts_updated: hostsUpdated,
      message: `${total} elemento${total !== 1 ? "i" : ""} aggiornato${total !== 1 ? "i" : ""}`,
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
      { status: 500 }
    );
  }
}
