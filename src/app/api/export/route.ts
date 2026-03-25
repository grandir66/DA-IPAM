import { NextRequest, NextResponse } from "next/server";
import { getHostsByNetwork, getAllHostsFlat } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";
import { joinCsvRow } from "@/lib/csv-utils";
import type { Host } from "@/types";

export async function GET(request: NextRequest) {
  return withTenantFromSession(async () => {
    const networkId = request.nextUrl.searchParams.get("network_id");

    let hosts: Host[];
    if (networkId) {
      hosts = getHostsByNetwork(Number(networkId));
    } else {
      hosts = getAllHostsFlat();
    }

    const headers = [
      "ip",
      "mac",
      "vendor",
      "hostname",
      "dns_forward",
      "dns_reverse",
      "custom_name",
      "classification",
      "inventory_code",
      "notes",
      "status",
      "last_seen",
      "first_seen",
    ];

    const csvRows = [
      joinCsvRow(headers),
      ...hosts.map((h) =>
        joinCsvRow(headers.map((key) => String(h[key as keyof Host] ?? "")))
      ),
    ];

    return new NextResponse("\uFEFF" + csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hosts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
