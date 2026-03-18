import { NextResponse } from "next/server";
import { getNetworkDeviceById } from "@/lib/db";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const BulkScanSchema = z.object({
  device_ids: z.array(z.coerce.number().int().positive()).min(1, "Specificare almeno un dispositivo"),
});

/**
 * Scansione batch: per ogni dispositivo selezionato:
 * 1. Testa le credenziali (GET /api/devices/[id]/test)
 * 2. Se il test passa, esegue la scansione appropriata (query o proxmox-scan)
 *
 * POST /api/devices/bulk-scan
 * Body: { device_ids: number[] }
 */
export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = BulkScanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }

    const { device_ids } = parsed.data;
    const base = new URL(request.url).origin;

    const scanned: { id: number; name: string; message: string }[] = [];
    const failed: { id: number; name: string; error: string }[] = [];

    for (const id of device_ids) {
      const device = getNetworkDeviceById(id);
      if (!device) {
        failed.push({ id, name: String(id), error: "Dispositivo non trovato" });
        continue;
      }

      // 1. Test credenziali
      const testRes = await fetch(`${base}/api/devices/${id}/test`, { cache: "no-store" });
      const testData = await testRes.json();
      if (!testData?.success) {
        failed.push({
          id,
          name: device.name,
          error: testData?.error ?? "Test credenziali fallito",
        });
        continue;
      }

      // 2. Esegui scansione appropriata
      const scanTarget = (device as { scan_target?: string | null }).scan_target;
      const isProxmox =
        scanTarget === "proxmox" ||
        device.device_type === "hypervisor" ||
        (device.classification === "hypervisor" && device.protocol === "api");

      const scanUrl = isProxmox
        ? `${base}/api/devices/${id}/proxmox-scan`
        : `${base}/api/devices/${id}/query`;
      const scanRes = await fetch(scanUrl, { method: "POST", cache: "no-store" });
      const scanData = await scanRes.json();

      if (scanRes.ok && scanData?.message) {
        scanned.push({ id, name: device.name, message: scanData.message });
      } else {
        failed.push({
          id,
          name: device.name,
          error: scanData?.error ?? "Errore durante la scansione",
        });
      }
    }

    const message =
      scanned.length > 0
        ? `${scanned.length} dispositivo${scanned.length !== 1 ? "i" : ""} scansionat${scanned.length !== 1 ? "i" : "o"}${failed.length > 0 ? `, ${failed.length} saltati (credenziali non funzionanti o errore)` : ""}`
        : failed.length > 0
          ? `Nessun dispositivo scansionato. ${failed.length} fallit${failed.length !== 1 ? "i" : "o"}.`
          : "Nessun dispositivo da scansionare.";

    return NextResponse.json({
      success: scanned.length > 0,
      scanned: scanned.length,
      failed: failed.length,
      results: scanned,
      errors: failed,
      message,
    });
  } catch (error) {
    console.error("Bulk scan error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nella scansione batch" },
      { status: 500 }
    );
  }
}
