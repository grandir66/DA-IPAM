import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getAllHostsVulnSummary } from "@/lib/db-tenant";
import { getHostById } from "@/lib/db";
import { getCurrentInvAgentInventory } from "@/lib/inventory-agent/db";
import { isInventoryAgentEnabled } from "@/lib/inventory-agent/feature";
import { maskLicenseKey } from "@/lib/inventory-agent/mask-license";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const tenantCode = getCurrentTenantCode();
    if (!tenantCode || !(await isInventoryAgentEnabled(tenantCode))) {
      return NextResponse.json({ enabled: false, endpoint: null, software: [], licenses: [], runtime: [] });
    }
    const { id } = await params;
    const hostId = Number(id);
    const host = getHostById(hostId);
    if (!host) {
      return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
    }

    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    const isAdmin = role === "admin" || role === "superadmin";

    const data = getCurrentInvAgentInventory(hostId);
    const vulnSummary = getAllHostsVulnSummary().get(hostId) ?? null;

    const licenses = data.licenses.map((lic) => ({
      ...lic,
      license_key: isAdmin ? lic.license_key : maskLicenseKey(lic.license_key),
    }));

    const securityFlags = {
      remote_mgmt_count: data.runtime.filter((r) => r.category === "remote_mgmt").length,
      firewall_off: data.runtime.some(
        (r) => r.category === "firewall" && r.status?.toLowerCase() === "off",
      ),
      av_disabled: (data.profile?.antivirus ?? []).some((av) => av.enabled === false),
      av_outdated: (data.profile?.antivirus ?? []).some((av) => av.uptodate === false),
    };

    return NextResponse.json({
      enabled: true,
      ...data,
      licenses,
      vuln_summary: vulnSummary,
      security_flags: securityFlags,
      license_keys_visible: isAdmin,
    });
  });
}
