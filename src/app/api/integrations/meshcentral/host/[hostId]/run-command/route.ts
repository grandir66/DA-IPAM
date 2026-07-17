/**
 * POST /api/integrations/meshcentral/host/[hostId]/run-command
 *
 * Esegue un comando shell sull'endpoint e ne ritorna l'output.
 * Body: { command: string, powershell?: boolean, runAsUser?: 0|1|2 }
 *
 * requireAdmin NON negoziabile: e' esecuzione di codice remoto come root/SYSTEM.
 * withTenantFromSession OBBLIGATORIO: senza contesto tenant le funzioni sul DB
 * lanciano e la rotta risponde 500 (era il bug della rotta config, 2026-07-17).
 *
 * L'output torna solo nella risposta HTTP: non viene loggato né salvato (puo'
 * contenere segreti). In mc_command_log restano comando, operatore ed esito.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { runRemoteCommand } from "@/lib/integrations/meshcentral/run-command";

const bodySchema = z.object({
  command: z.string().min(1).max(8000),
  powershell: z.boolean().optional(),
  runAsUser: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
});

function parseHostId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) {
    return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
  }

  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
        { status: 400 },
      );
    }

    const res = await runRemoteCommand({
      hostId,
      command: parsed.data.command,
      powershell: parsed.data.powershell,
      runAsUser: parsed.data.runAsUser,
      operator: auth.user.email ?? "unknown",
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({ output: res.output }, { status: 200 });
  });
}
