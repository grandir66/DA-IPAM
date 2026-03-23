import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { detectProtocol } from "@/lib/devices/protocol-detect";

const DetectSchema = z.object({
  host: z.string().min(1, "Host richiesto"),
  timeout: z.coerce.number().int().min(500).max(10000).optional(),
});

/**
 * Auto-detect del protocollo migliore per un device.
 * POST /api/devices/detect-protocol
 * Body: { host: "192.168.1.1", timeout?: 3000 }
 * Risposta: { protocol, port, openPorts }
 */
export async function POST(req: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const body = await req.json();
    const parsed = DetectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { host, timeout } = parsed.data;
    const result = await detectProtocol(host, timeout ?? 3000);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Errore rilevamento protocollo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
