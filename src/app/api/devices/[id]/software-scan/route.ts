/**
 * POST /api/devices/[id]/software-scan
 *
 * Avvia uno scan inventario software per un network_device gestito.
 * Body opzionale:
 *   { credentialId?: number, timeoutMs?: number, port?: number, realm?: string }
 *
 * Se `credentialId` non è specificato, viene usata la credenziale linkata al
 * device (`network_devices.credential_id`). Il device deve avere
 * `vendor IN ('windows','linux')`, altrimenti l'endpoint risponde 400.
 *
 * Esecuzione INLINE (oggi): la response arriva quando il probe ha finito.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { runSoftwareScan } from "@/lib/probes/software-runner";

const Body = z.object({
  credentialId: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  realm: z.string().min(1).max(255).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const deviceId = Number(id);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return NextResponse.json({ error: "id device non valido" }, { status: 400 });
    }

    let body: unknown = {};
    if (request.headers.get("content-length") !== "0") {
      try {
        const raw = await request.text();
        if (raw.length > 0) body = JSON.parse(raw);
      } catch {
        return NextResponse.json(
          { error: "Body non valido (JSON atteso)" },
          { status: 400 }
        );
      }
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 }
      );
    }

    const session = await auth();
    const userId = session?.user?.id ? Number(session.user.id) : null;

    try {
      const result = await runSoftwareScan({
        target: { kind: "device", deviceId },
        credentialId: parsed.data.credentialId,
        timeoutMs: parsed.data.timeoutMs,
        port: parsed.data.port,
        realm: parsed.data.realm,
        triggeredByUserId: userId,
        triggeredBy: "manual",
      });
      return NextResponse.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Errore software scan device:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
