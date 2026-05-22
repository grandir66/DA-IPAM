/**
 * POST /api/hosts/[id]/software-scan
 *
 * Avvia uno scan inventario software per l'host. Body:
 *   { credentialId: number, timeoutMs?: number, port?: number, realm?: string }
 *
 * Esecuzione INLINE (oggi): la response arriva quando il probe ha finito.
 * In futuro l'endpoint potrà passare a coda asincrona senza cambiare contratto
 * (ritorna sempre `{ scanId, status, appsCount, errorMessage? }`).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { runSoftwareScan } from "@/lib/probes/software-runner";

const Body = z.object({
  credentialId: z.number().int().positive(),
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
    const hostId = Number(id);
    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json({ error: "id host non valido" }, { status: 400 });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body non valido (JSON atteso)" },
        { status: 400 }
      );
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
        target: { kind: "host", hostId },
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
      console.error("Errore software scan:", msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
