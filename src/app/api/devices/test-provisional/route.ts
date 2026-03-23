import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  runProvisionalDeviceTest,
  isWindowsDevice,
  getWindowsHint,
} from "@/lib/devices/device-connection-test";
import { PRODUCT_PROFILE_IDS } from "@/lib/device-product-profiles";

const productProfileEnum = z.enum(PRODUCT_PROFILE_IDS as unknown as [string, ...string[]]);

const ProvisionalTestSchema = z.object({
  host: z.string().min(1, "Host richiesto"),
  vendor: z.enum([
    "mikrotik", "ubiquiti", "hp", "cisco", "omada", "stormshield",
    "proxmox", "vmware", "linux", "windows", "synology", "qnap", "other"
  ]),
  protocol: z.enum(["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]),
  port: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  snmp_credential_id: z.coerce.number().int().positive().optional().nullable(),
  scan_target: z.enum(["proxmox", "vmware", "windows", "linux"]).optional().nullable(),
  product_profile: productProfileEnum.optional().nullable(),
  api_url: z.string().optional().nullable(),
});

/**
 * Testa una connessione senza salvare il dispositivo.
 * POST /api/devices/test-provisional
 * Body: { host, vendor, protocol, port?, credential_id?, snmp_credential_id?, scan_target?, api_url? }
 */
export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const body = await request.json();
    const parsed = ProvisionalTestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }

    const provisional = {
      host: parsed.data.host,
      vendor: parsed.data.vendor,
      protocol: parsed.data.protocol,
      port: parsed.data.port ?? undefined,
      credential_id: parsed.data.credential_id ?? null,
      snmp_credential_id: parsed.data.snmp_credential_id ?? null,
      scan_target: parsed.data.scan_target ?? null,
      product_profile: parsed.data.product_profile ?? null,
      api_url: parsed.data.api_url ?? null,
    };

    const result = await runProvisionalDeviceTest(provisional);

    if (!result.success && result.error) {
      const isWin = isWindowsDevice({
        vendor: provisional.vendor,
        protocol: provisional.protocol,
        scan_target: provisional.scan_target,
      });
      if (isWin) {
        result.error += getWindowsHint(result.error);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Errore nel test di connessione";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 200 }
    );
  }
}
