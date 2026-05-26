import { NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork, getDb, getFingerprintClassificationRulesForResolve } from "@/lib/db";
import { getCustomClassificationBySlug } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { classifyDevice } from "@/lib/device-classifier";
import { getClassificationFromFingerprintSnapshot } from "@/lib/device-fingerprint-classification";
import type { DeviceFingerprintSnapshot } from "@/types";

/**
 * POST /api/networks/[id]/apply-classifications
 * Applica le riclassificazioni solo agli host selezionati dall'utente
 * dopo l'anteprima (dryRun) di /refresh.
 *
 * Body: { host_ids: number[], force?: boolean }
 *   - host_ids: lista host su cui scrivere la nuova classificazione
 *   - force: se true, sovrascrive anche classification_manual=1 e azzera il flag
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  // Bug fix audit 2026-05-26 (A2): senza withTenantFromSession getDb() cade su
  // tenant DEFAULT, scrivendo su data/tenants/DEFAULT.db invece del tenant
  // dell'utente loggato.
  return withTenantFromSession(async () => {
  try {
    const { id } = await params;
    const body = await _request.json().catch(() => ({})) as { host_ids?: number[]; force?: boolean };
    const hostIds = Array.isArray(body.host_ids) ? body.host_ids : [];
    const force = body.force === true;

    if (hostIds.length === 0) {
      return NextResponse.json({ error: "Nessun host selezionato" }, { status: 400 });
    }

    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    const allHosts = getHostsByNetwork(Number(id));
    const selectedSet = new Set(hostIds);
    const fpUserRules = getFingerprintClassificationRulesForResolve();
    const db = getDb();

    let applied = 0;
    let skipped = 0;

    for (const host of allHosts) {
      if (!selectedSet.has(host.id)) continue;

      const classificationManual = (host as unknown as Record<string, unknown>).classification_manual === 1;
      if (classificationManual && !force) {
        skipped++;
        continue;
      }

      let openPorts: Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }> | null = null;
      if (host.open_ports) {
        try { openPorts = JSON.parse(host.open_ports); } catch { /* ignore */ }
      }

      let fpSnap: DeviceFingerprintSnapshot | null = null;
      if (host.detection_json) {
        try {
          fpSnap = JSON.parse(host.detection_json) as DeviceFingerprintSnapshot;
        } catch { /* ignore */ }
      }

      const fromFingerprint = fpSnap ? getClassificationFromFingerprintSnapshot(fpSnap, fpUserRules) : undefined;
      const fromRules = classifyDevice({
        sysDescr: fpSnap?.snmp_sysdescr ?? host.os_info ?? null,
        sysObjectID: fpSnap?.snmp_vendor_oid ?? null,
        osInfo: host.os_info ?? null,
        openPorts,
        hostname: host.hostname ?? null,
        vendor: host.vendor ?? null,
      });
      const newClassification = fromFingerprint ?? fromRules;

      // Bug fix audit 2026-05-26 (A3): se classification corrente è custom
      // child del newClassification proposto, NON sovrascrivere — la custom
      // è più specifica del parent built-in (es. server_postgres → server).
      const currentCustom = host.classification ? getCustomClassificationBySlug(host.classification) : undefined;
      const currentIsCustomChildOfNew = currentCustom?.parent_slug === newClassification;

      if (!newClassification || newClassification === host.classification || currentIsCustomChildOfNew) {
        skipped++;
        continue;
      }

      const sets: string[] = ["classification = ?", "updated_at = datetime('now')"];
      const vals: unknown[] = [newClassification];
      if (force && classificationManual) {
        sets.push("classification_manual = 0");
      }
      vals.push(host.id);
      db.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      applied++;
    }

    return NextResponse.json({
      success: true,
      applied,
      skipped,
      total_selected: hostIds.length,
      message: `${applied} classificazioni applicate, ${skipped} saltate`,
    });
  } catch (error) {
    console.error("Apply classifications error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nell'applicazione" },
      { status: 500 }
    );
  }
  });
}
