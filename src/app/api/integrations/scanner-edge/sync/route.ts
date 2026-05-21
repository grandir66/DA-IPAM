/**
 * Trigger manuale del sync findings dallo scanner-edge.
 * Identica logica del cron job, eseguita on-demand dall'admin.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { runVulnSync } from "@/lib/vuln/sync-job";

export async function POST() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  return await withTenantFromSession(async () => {
    const result = await runVulnSync();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  });
}
