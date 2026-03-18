import { NextResponse } from "next/server";
import {
  getNetworks,
  getHostsByNetwork,
  getInventoryAssetByHost,
  ensureInventoryAssetForHost,
  syncInventoryFromHost,
} from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

/**
 * Sincronizza gli host con l'inventario.
 * Crea un asset per ogni host che non ne ha (priorità: known_host o con model/serial),
 * e aggiorna tutti con i dati da host (IP, MAC, model, serial, classification).
 */
export async function POST() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const networks = getNetworks();
    const allHosts = networks.flatMap((n) => getHostsByNetwork(n.id));

    let created = 0;
    let updated = 0;

    for (const host of allHosts) {
      // Crea asset solo per host "conosciuti" o con dati utili (model, serial, hostname)
      const hasUsefulData =
        host.known_host === 1 ||
        host.model != null ||
        host.serial_number != null ||
        (host.custom_name ?? host.hostname) != null;

      if (!hasUsefulData) continue;

      const hadAsset = !!getInventoryAssetByHost(host.id);
      ensureInventoryAssetForHost(host);
      if (!hadAsset) created++;

      const synced = syncInventoryFromHost(host);
      if (synced) updated++;
    }

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} host aggiunto${created !== 1 ? "i" : ""} all'inventario`);
    if (updated > 0) parts.push(`${updated} aggiornato${updated !== 1 ? "i" : ""} con dati host`);

    return NextResponse.json({
      success: true,
      total: allHosts.length,
      processed: allHosts.filter(
        (h) =>
          h.known_host === 1 ||
          h.model != null ||
          h.serial_number != null ||
          (h.custom_name ?? h.hostname) != null
      ).length,
      created,
      updated,
      message:
        parts.length > 0
          ? parts.join(", ")
          : "Nessun host con dati sufficienti da sincronizzare (known_host, model, serial o hostname)",
    });
  } catch (error) {
    console.error("Sync hosts to inventory:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nella sincronizzazione" },
      { status: 500 }
    );
  }
}
