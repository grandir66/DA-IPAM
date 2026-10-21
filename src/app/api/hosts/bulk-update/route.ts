import { NextResponse } from "next/server";
import { updateHost, getDb } from "@/lib/db";
import { scriviClassificazione } from "@/lib/classification/scrivi";
import { assegnaCredenzialeAgliHost, VoceNonValePerProtocollo } from "@/lib/credentials/lega-voce";
import {
  bulkUpdateNetworkDeviceByHostId,
  bulkUpdateInventoryAssetByHostId,
} from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { avviaChocoDopoCredenziali } from "@/lib/patch/choco-automatico";
import { z } from "zod";
import { classificazioneCanonicaEnum } from "@/lib/validators";

const classificationSchema = classificazioneCanonicaEnum();
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
  credential_protocol: z.enum(["ssh", "snmp", "winrm", "api", "redfish", "onvif"]).optional(),
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

      // Assegna la credenziale: riga host validata (scelta esplicita, deve
      // comparire subito nella discovery) e binding sull'apparato con lo stesso
      // IP. La voce deve valere per il protocollo scelto (T13, 16/10): prima un
      // account AD finiva come riga host WinRM e il motore lo scartava in
      // silenzio. assegnaCredenzialeAgliHost controlla una volta, prima di
      // toccare qualunque host; qui il rifiuto diventa un 400.
      let credentialsAdded = 0;
      let credentialsFailed = 0;
      if (credential_id != null && credential_id > 0) {
        const proto = credential_protocol ?? "ssh";
        const port = credential_port ?? (proto === "snmp" ? 161 : proto === "winrm" ? 5985 : proto === "api" ? 443 : 22);
        try {
          const esito = assegnaCredenzialeAgliHost(host_ids, credential_id, proto, port);
          credentialsAdded = esito.aggiunte;
          credentialsFailed = esito.falliti.length;
          // WinRM assegnato in blocco: Chocolatey si installa da solo dove serve (21/10).
          if (proto === "winrm") avviaChocoDopoCredenziali(host_ids.filter((h) => !esito.falliti.includes(h)));
        } catch (err) {
          if (err instanceof VoceNonValePerProtocollo) return NextResponse.json({ error: err.message }, { status: 400 });
          throw err;
        }
      }

      let updated = 0;
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
        if (known_host !== undefined) update.known_host = known_host;
        if (notes !== undefined) update.notes = notes;
        if (device_manufacturer !== undefined) update.device_manufacturer = device_manufacturer;
        if (ip_assignment !== undefined) update.ip_assignment = ip_assignment;

        if (Object.keys(update).length > 0) {
          const result = updateHost(id, update as Parameters<typeof updateHost>[1]);
          if (result) updated++;
        }
        // Classificazione dal punto unico: scrive anche sull'apparato abbinato.
        if (classification !== undefined) {
          const r = scriviClassificazione(getDb(), { hostId: id }, classification, { manuale: true });
          if (r.hostId != null && Object.keys(update).length === 0) updated++;
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
      if (credentialsFailed > 0) parts.push(`credenziale non assegnata a ${credentialsFailed} host per un errore`);
      if (devicesUpdated > 0) parts.push(`${devicesUpdated} device aggiornat${devicesUpdated !== 1 ? "i" : "o"}`);
      if (assetsUpdated > 0) parts.push(`${assetsUpdated} asset aggiornat${assetsUpdated !== 1 ? "i" : "o"}`);
      const message = parts.join(", ") || "Nessuna modifica";

      return NextResponse.json({
        success: true,
        updated,
        credentials_added: credentialsAdded,
        credentials_failed: credentialsFailed,
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
