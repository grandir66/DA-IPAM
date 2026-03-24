import { NextResponse } from "next/server";
import {
  getNetworkDevices,
  getDeviceIdsWithInventoryAsset,
  ensureInventoryAssetForNetworkDevice,
  syncInventoryFromDevice,
} from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * Sincronizza i dispositivi di rete con l'inventario.
 * Crea un asset per ogni device che non ne ha, e aggiorna tutti con i dati tecnici (SNMP, Proxmox, ecc.).
 */
export async function POST() {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const devices = getNetworkDevices();
      const existingAssetDeviceIds = getDeviceIdsWithInventoryAsset();
      let created = 0;
      let updated = 0;

      for (const device of devices) {
        const hadAsset = existingAssetDeviceIds.has(device.id);
        ensureInventoryAssetForNetworkDevice(device);
        if (!hadAsset) created++;

        const synced = syncInventoryFromDevice(device);
        if (synced) updated++;
      }

      const parts: string[] = [];
      if (created > 0) parts.push(`${created} aggiunto${created !== 1 ? "i" : ""}`);
      if (updated > 0) parts.push(`${updated} aggiornato${updated !== 1 ? "i" : ""} con dati tecnici`);

      return NextResponse.json({
        success: true,
        total: devices.length,
        created,
        updated,
        message: parts.length > 0
          ? parts.join(", ")
          : "Nessun dispositivo da sincronizzare",
      });
    } catch (error) {
      console.error("Sync devices to inventory:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nella sincronizzazione" },
        { status: 500 }
      );
    }
  });
}
