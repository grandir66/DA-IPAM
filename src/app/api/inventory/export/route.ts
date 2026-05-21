import { NextRequest, NextResponse } from "next/server";
import { getInventoryAssets } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { joinCsvRow } from "@/lib/csv-utils";
import { buildNis2InventoryCsv } from "@/lib/inventory/nis2-export";
import { buildAssetGapReports, summarizeGaps } from "@/lib/inventory/nis2-gaps";
import crypto from "crypto";

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
    const formatParam = searchParams.get("format");
    const format = formatParam === "itam" ? "itam" : formatParam === "nis2-audit" ? "nis2-audit" : "nis2";

    const assets = getInventoryAssets({
      ...(stato && { stato }),
      ...(categoria && { categoria }),
      ...(inScopeNis2 === "1" && { in_scope_nis2: 1 }),
      ...(inScopeNis2 === "0" && { in_scope_nis2: 0 }),
      ...(limit && { limit: Math.min(Number(limit) || 500, 2000) }),
    });

    const date = new Date().toISOString().slice(0, 10);

    if (format === "nis2-audit") {
      // Report compliance: per ogni asset in scope, gap rilevati + score, con manifest sha256.
      const reports = buildAssetGapReports(assets as import("@/types").InventoryAsset[]);
      const summary = summarizeGaps(reports);
      const generatedAt = new Date().toISOString();

      const headers = [
        "asset_id", "asset_tag", "hostname", "criticita_nis2", "conformance_score",
        "n_gaps", "gaps_critico", "gaps_alto", "gaps_medio", "gaps_basso",
        "gaps_dettaglio",
      ];
      const lines: string[] = [];
      lines.push(`# DA-IPAM NIS2 audit export — generated_at=${generatedAt}`);
      lines.push(`# total_in_scope=${summary.total_in_scope} total_with_gaps=${summary.total_with_gaps} avg_score=${summary.avg_conformance_score}`);
      lines.push(`# severity: critico=${summary.by_severity.critico} alto=${summary.by_severity.alto} medio=${summary.by_severity.medio} basso=${summary.by_severity.basso}`);
      lines.push(joinCsvRow(headers));
      for (const r of reports) {
        const bySev = { critico: 0, alto: 0, medio: 0, basso: 0 };
        for (const g of r.gaps) bySev[g.severity]++;
        const dettaglio = r.gaps.map((g) => `[${g.severity}] ${g.field}: ${g.message}`).join(" | ");
        lines.push(joinCsvRow([
          String(r.asset_id),
          r.asset_tag ?? "",
          r.hostname ?? "",
          r.criticita_nis2 ?? "",
          String(r.conformance_score),
          String(r.gaps.length),
          String(bySev.critico), String(bySev.alto), String(bySev.medio), String(bySev.basso),
          dettaglio,
        ]));
      }
      const body = "\uFEFF" + lines.join("\n");
      const sha = crypto.createHash("sha256").update(body).digest("hex");
      lines.push(`# sha256=${sha}`);
      const finalBody = "\uFEFF" + lines.join("\n");
      return new NextResponse(finalBody, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="inventario-nis2-audit-${date}.csv"`,
          "X-Audit-Sha256": sha,
        },
      });
    }

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
