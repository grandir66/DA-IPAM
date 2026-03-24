import { NextResponse } from "next/server";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getEnabledSnmpVendorProfiles, getDistinctHostVendorHints } from "@/lib/db";
import { buildNetworkDeviceVendorSelectOptionsFromData } from "@/lib/network-device-vendor-options";

/**
 * GET: opzioni vendor per form dispositivi (profili SNMP abilitati + IPAM).
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const snmpProfiles = getEnabledSnmpVendorProfiles();
  const hostVendorHints = getDistinctHostVendorHints();
  const options = buildNetworkDeviceVendorSelectOptionsFromData({
    snmpProfiles,
    hostVendorHints,
  });

  return NextResponse.json({ options });
  });
}
