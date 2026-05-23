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
import { getMultihomedStatusByDeviceId } from "@/lib/db";

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

    // Multihomed dedup: se device è secondary di un gruppo multihomed,
    // saltiamo lo scan software (lo stesso device verrebbe interrogato N volte).
    // Bypass: ?force=1 nella query string.
    const force = new URL(request.url).searchParams.get("force") === "1";
    const mh = getMultihomedStatusByDeviceId(deviceId);
    if (mh && !mh.is_primary && !force) {
      return NextResponse.json({
        error: "scan_skipped_multihomed_secondary",
        message: `Device secondary di un gruppo multihomed (${mh.peers_count} IF). Software scan saltato: esegui sul primary (${mh.primary_ip}) o forza con ?force=1.`,
        multihomed: { group_id: mh.group_id, primary_host_id: mh.primary_host_id, primary_ip: mh.primary_ip, peers_count: mh.peers_count },
      }, { status: 409 });
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
