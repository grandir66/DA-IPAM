import { NextResponse } from "next/server";
import { runHubBackup } from "@/lib/backup/engine";
import { getActiveTenants } from "@/lib/db-hub";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

/**
 * POST /api/admin/backup-now
 *
 * Trigger manuale di un backup nightly fuori schedule. Comodo dopo grosse
 * scritture o prima di operazioni rischiose.
 *
 * Restituisce il manifest JSON con elenco file, sha256, durata.
 */
export async function POST() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const tenants = getActiveTenants();
    const codes = tenants.map((t) => t.codice_cliente);
    const manifest = await runHubBackup(codes);

    const status = manifest.errors.length === 0 ? 200 : 207; // 207 multi-status if partial
    return NextResponse.json(manifest, { status });
  } catch (e) {
    console.error("Errore POST /api/admin/backup-now:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore interno" },
      { status: 500 },
    );
  }
}
