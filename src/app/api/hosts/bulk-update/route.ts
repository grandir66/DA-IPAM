import { NextResponse } from "next/server";
import { updateHost, addHostCredential, getHostCredentials } from "@/lib/db";
import {
  bulkUpdateNetworkDeviceByHostId,
  bulkUpdateInventoryAssetByHostId,
  addDeviceCredentialBinding,
  getNetworkDeviceByIp,
  getDeviceCredentialBindings,
  getHostById,
} from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { z } from "zod";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

const classificationSchema = z.enum(DEVICE_CLASSIFICATIONS as unknown as [string, ...string[]]);
const deviceTypeSchema = z.enum(["router", "switch", "firewall", "hypervisor"]);
const vendorSchema = z.enum([
  "mikrotik","ubiquiti","hp","cisco","omada","stormshield","proxmox","vmware",
  "linux","windows","synology","qnap","other",
]);
const scanTargetSchema = z.enum(["proxmox","vmware","windows","linux"]);

const BulkHostUpdateSchema = z.object({
  host_ids: z.array(z.coerce.number().int().positive()).min(1, "Selezionare almeno un host"),
  // hosts
  classification: classificationSchema.optional(),
  known_host: z.union([z.literal(0), z.literal(1)]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  device_manufacturer: z.string().max(200).optional().nullable(),
  ip_assignment: z.enum(["dynamic", "static", "reserved", "unknown"]).optional(),
  // Credenziali da assegnare a tutti gli host selezionati
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  credential_protocol: z.enum(["ssh", "snmp", "winrm", "api"]).optional(),
  credential_port: z.coerce.number().int().min(1).max(65535).optional(),
  // network_devices (applicati a quelli linkati via IP=hosts.ip)
  device_type: deviceTypeSchema.optional(),
  vendor: vendorSchema.optional(),
  scan_target: scanTargetSchema.optional(),
  // inventory_assets (applicati a quelli con host_id)
  asset_categoria_nis2: z.string().max(64).optional(),
  asset_criticita_nis2: z.string().max(32).optional(),
});

/**
 * PATCH /api/hosts/bulk-update
 * Aggiorna campi comuni su più host (cross-network).
 */
export async function PATCH(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const body = await request.json();
      const parsed = BulkHostUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
          { status: 400 },
        );
      }

      const {
        host_ids, classification, known_host, notes,
        device_manufacturer, ip_assignment,
        credential_id, credential_protocol, credential_port,
        device_type, vendor, scan_target,
        asset_categoria_nis2, asset_criticita_nis2,
      } = parsed.data;

      const hasField =
        classification !== undefined ||
        known_host !== undefined ||
        notes !== undefined ||
        device_manufacturer !== undefined ||
        ip_assignment !== undefined ||
        (credential_id != null && credential_id > 0) ||
        device_type !== undefined ||
        vendor !== undefined ||
        scan_target !== undefined ||
        asset_categoria_nis2 !== undefined ||
        asset_criticita_nis2 !== undefined;

      if (!hasField) {
        return NextResponse.json(
          { error: "Specificare almeno un campo da aggiornare" },
          { status: 400 },
        );
      }

      let updated = 0;
      let credentialsAdded = 0;
      let devicesUpdated = 0;
      let assetsUpdated = 0;

      // Build update SQL fragments per tabella secondaria
      const ndUpdate: Record<string, unknown> = {};
      if (device_type !== undefined) ndUpdate.device_type = device_type;
      if (vendor !== undefined) ndUpdate.vendor = vendor;
      if (scan_target !== undefined) ndUpdate.scan_target = scan_target;

      const assetUpdate: Record<string, unknown> = {};
      if (asset_categoria_nis2 !== undefined) assetUpdate.categoria_nis2 = asset_categoria_nis2;
      if (asset_criticita_nis2 !== undefined) assetUpdate.criticita_nis2 = asset_criticita_nis2;

      for (const id of host_ids) {
        // Aggiorna campi host
        const update: Record<string, unknown> = {};
        if (classification !== undefined) update.classification = classification;
        if (known_host !== undefined) update.known_host = known_host;
        if (notes !== undefined) update.notes = notes;
        if (device_manufacturer !== undefined) update.device_manufacturer = device_manufacturer;
        if (ip_assignment !== undefined) update.ip_assignment = ip_assignment;

        if (Object.keys(update).length > 0) {
          const result = updateHost(id, update as Parameters<typeof updateHost>[1]);
          if (result) updated++;
        }

        // Assegna credenziale: aggiunge a host_credentials (marcata validated=1 perché
        // è una scelta utente esplicita, deve apparire subito nel discovery) e propaga
        // a device_credential_bindings se l'host ha network_device linkato.
        if (credential_id != null && credential_id > 0) {
          const proto = credential_protocol ?? "ssh";
          const port = credential_port ?? (proto === "snmp" ? 161 : proto === "winrm" ? 5985 : proto === "api" ? 443 : 22);
          try {
            const existing = getHostCredentials(id);
            const alreadyBound = existing.some(
              (hc) => hc.credential_id === credential_id && hc.protocol_type === proto,
            );
            if (!alreadyBound) {
              addHostCredential(id, credential_id, proto, port, { validated: true });
              credentialsAdded++;
            }
            // Propaga al device linkato (network_devices.host = hosts.ip)
            const host = getHostById(id);
            if (host) {
              const device = getNetworkDeviceByIp(host.ip);
              if (device && (proto === "ssh" || proto === "snmp" || proto === "winrm" || proto === "api")) {
                const dcb = getDeviceCredentialBindings(device.id);
                const dcbExists = dcb.some(
                  (b) => b.credential_id === credential_id && b.protocol_type === proto && b.port === port,
                );
                if (!dcbExists) {
                  addDeviceCredentialBinding({
                    device_id: device.id,
                    credential_id,
                    protocol_type: proto,
                    port,
                    auto_detected: false,
                  });
                }
              }
            }
          } catch {
            // Host non trovato o errore DB — skip
          }
        }

        // Aggiorna network_devices linkati via IP (se ci sono campi device da aggiornare)
        if (Object.keys(ndUpdate).length > 0) {
          try {
            devicesUpdated += bulkUpdateNetworkDeviceByHostId(id, ndUpdate);
          } catch {
            // skip su tenant DB error
          }
        }

        // Aggiorna inventory_assets linkati al host_id (se ci sono campi asset da aggiornare)
        if (Object.keys(assetUpdate).length > 0) {
          try {
            assetsUpdated += bulkUpdateInventoryAssetByHostId(id, assetUpdate);
          } catch {
            // skip
          }
        }
      }

      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} host aggiornato${updated !== 1 ? "i" : ""}`);
      if (credentialsAdded > 0) parts.push(`${credentialsAdded} credenzial${credentialsAdded !== 1 ? "i" : "e"} assegnat${credentialsAdded !== 1 ? "e" : "a"}`);
      if (devicesUpdated > 0) parts.push(`${devicesUpdated} device aggiornat${devicesUpdated !== 1 ? "i" : "o"}`);
      if (assetsUpdated > 0) parts.push(`${assetsUpdated} asset aggiornat${assetsUpdated !== 1 ? "i" : "o"}`);
      const message = parts.join(", ") || "Nessuna modifica";

      return NextResponse.json({
        success: true,
        updated,
        credentials_added: credentialsAdded,
        devices_updated: devicesUpdated,
        assets_updated: assetsUpdated,
        message,
      });
    } catch (error) {
      console.error("Bulk host update error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
        { status: 500 },
      );
    }
  });
}
