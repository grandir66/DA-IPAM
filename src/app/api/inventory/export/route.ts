import { NextRequest, NextResponse } from "next/server";
import { getInventoryAssets } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { joinCsvRow } from "@/lib/csv-utils";

/** Export inventario in CSV (campi essenziali per asset management) */
export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const { searchParams } = new URL(request.url);
    const stato = searchParams.get("stato");
    const categoria = searchParams.get("categoria");
    const limit = searchParams.get("limit");

    const assets = getInventoryAssets({
      ...(stato && { stato }),
      ...(categoria && { categoria }),
      ...(limit && { limit: Math.min(Number(limit) || 500, 2000) }),
    });

    const headers = [
      "asset_tag",
      "serial_number",
      "hostname",
      "nome_prodotto",
      "categoria",
      "marca",
      "modello",
      "stato",
      "sede",
      "reparto",
      "posizione_fisica",
      "ip_address",
      "mac_address",
      "fine_garanzia",
      "fine_supporto",
      "sistema_operativo",
      "cpu",
      "ram_gb",
      "storage_gb",
      "firmware_version",
      "prezzo_acquisto",
      "fornitore",
      "contratto_supporto",
      "note_tecniche",
      "network_device_name",
      "host_ip",
    ];

    const csvRows = [
      joinCsvRow(headers),
      ...assets.map((a) =>
        joinCsvRow(
          headers.map((key) => String((a as unknown as Record<string, unknown>)[key] ?? ""))
        )
      ),
    ];

    return new NextResponse("\uFEFF" + csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inventario-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
