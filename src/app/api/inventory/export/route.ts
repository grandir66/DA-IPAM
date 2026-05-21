import { NextRequest, NextResponse } from "next/server";
import { getInventoryAssets } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { joinCsvRow } from "@/lib/csv-utils";
import { buildNis2InventoryCsv } from "@/lib/inventory/nis2-export";

const ITAM_HEADERS = [
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

/** Export inventario CSV — `format=nis2` (default) o `format=itam` (completo). */
export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const { searchParams } = new URL(request.url);
    const stato = searchParams.get("stato");
    const categoria = searchParams.get("categoria");
    const inScopeNis2 = searchParams.get("in_scope_nis2");
    const limit = searchParams.get("limit");
    const format = searchParams.get("format") === "itam" ? "itam" : "nis2";

    const assets = getInventoryAssets({
      ...(stato && { stato }),
      ...(categoria && { categoria }),
      ...(inScopeNis2 === "1" && { in_scope_nis2: 1 }),
      ...(inScopeNis2 === "0" && { in_scope_nis2: 0 }),
      ...(limit && { limit: Math.min(Number(limit) || 500, 2000) }),
    });

    const date = new Date().toISOString().slice(0, 10);

    if (format === "nis2") {
      const body = buildNis2InventoryCsv(assets as unknown as Record<string, unknown>[]);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="inventario-nis2-${date}.csv"`,
        },
      });
    }

    const csvRows = [
      joinCsvRow(ITAM_HEADERS),
      ...assets.map((a) =>
        joinCsvRow(
          ITAM_HEADERS.map((key) => String((a as unknown as Record<string, unknown>)[key] ?? ""))
        )
      ),
    ];

    return new NextResponse("\uFEFF" + csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inventario-itam-${date}.csv"`,
      },
    });
  });
}
