// src/app/api/tenant/export/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { exportTenant } from "@/lib/transfer/export";
import { registraScarico } from "@/lib/accesso/registro-scarichi";
import type { Tier } from "@/lib/transfer/types";
import pkg from "../../../../../package.json";

const schema = z.object({
  passphrase: z.string().min(8, "Passphrase di almeno 8 caratteri"),
  tiers: z.array(z.enum(["config", "asset", "history", "mirror"])).default(["asset", "mirror"]),
  includeVault: z.boolean().default(false),
});

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

    // Riccardo, 15/11/2026: «le password non devono uscire… neppure di fronte ad una compromissione». Il pacchetto
    // non porta più nessun segreto; chi chiede il vault riceve un rifiuto che lo dice, non un pacchetto più povero.
    if (parsed.data.includeVault) {
      return NextResponse.json(
        { error: "Le credenziali non si esportano più: il pacchetto porta la configurazione senza segreti." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const exportedAt = new Date().toISOString();
    const bundle = exportTenant({
      tenantDb: getTenantDb(tenantCode),
      hubDb: getHubDb(),
      options: {
        tenantCode,
        tiers: parsed.data.tiers as Tier[],
        includeVault: false,
        senzaSegreti: true,
        passphrase: parsed.data.passphrase,
        exportedAt,
        appVersion: (pkg as { version: string }).version,
      },
    });

    console.info(`[export] ${tenantCode}: pacchetto scaricato da ${auth.user.name ?? "?"} (senza segreti)`);
    registraScarico(getHubDb(), {
      cosa: "pacchetto",
      utenteId: auth.user.id != null ? String(auth.user.id) : null,
      utenteNome: auth.user.name ?? null,
      ruolo: auth.user.role ?? null,
      dettaglio: `${tenantCode}, senza segreti`,
    });
    const fname = `${tenantCode}-${exportedAt.replace(/[:.]/g, "-")}.dab`;
    return new NextResponse(new Uint8Array(bundle), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
