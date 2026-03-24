import { NextRequest, NextResponse } from "next/server";
import { getHostsByNetwork, getNetworks } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import type { Host } from "@/types";

export async function GET(request: NextRequest) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const networkId = request.nextUrl.searchParams.get("network_id");

  let hosts: Host[];
  if (networkId) {
    hosts = getHostsByNetwork(Number(networkId));
  } else {
    const networks = getNetworks();
    hosts = networks.flatMap((n) => getHostsByNetwork(n.id));
  }

  const headers = [
    "ip", "mac", "vendor", "hostname", "dns_forward", "dns_reverse",
    "custom_name", "classification", "inventory_code", "notes",
    "status", "last_seen", "first_seen",
  ];

  const csvRows = [
    headers.join(","),
    ...hosts.map((h) =>
      headers.map((key) => {
        const val = String(h[key as keyof Host] ?? "");
        return val.includes(",") || val.includes('"') || val.includes("\n")
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(",")
    ),
  ];

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hosts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
