import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getEnabledSnmpVendorProfiles, getDistinctHostVendorHints } from "@/lib/db";
import { buildNetworkDeviceVendorSelectOptionsFromData } from "@/lib/network-device-vendor-options";

/**
 * GET: opzioni vendor per form dispositivi (profili SNMP abilitati + IPAM).
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const snmpProfiles = getEnabledSnmpVendorProfiles();
  const hostVendorHints = getDistinctHostVendorHints();
  const options = buildNetworkDeviceVendorSelectOptionsFromData({
    snmpProfiles,
    hostVendorHints,
  });

  return NextResponse.json({ options });
}
