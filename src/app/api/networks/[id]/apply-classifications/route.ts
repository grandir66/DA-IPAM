import { NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork, getDb, getFingerprintClassificationRulesForResolve } from "@/lib/db";
import { getCustomClassificationBySlug } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { parseJsonSafe } from "@/lib/json-safe";
import { withTenantFromSession } from "@/lib/api-tenant";
import { classifyDevice } from "@/lib/device-classifier";
import { getClassificationFromFingerprintSnapshot } from "@/lib/device-fingerprint-classification";
import { runClassificationEngineForHost } from "@/lib/classification/run";
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

      const fpSnap = parseJsonSafe<DeviceFingerprintSnapshot | null>(host.detection_json, null);

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

      // A3: custom child più specifica del parent built-in → non chiamare engine
      if (!newClassification || newClassification === host.classification || currentIsCustomChildOfNew) {
        skipped++;
        continue;
      }

      const { touchedClassification } = await runClassificationEngineForHost({
        db,
        hostId: host.id,
        ip: host.ip,
        hostname: host.hostname,
        vendor: host.vendor,
        os_info: host.os_info,
        open_ports: openPorts,
        detection: fpSnap,
        snmp_sysdescr: fpSnap?.snmp_sysdescr ?? null,
        snmp_sysobjectid: fpSnap?.snmp_vendor_oid ?? null,
        cascade_slug: newClassification ?? null,
        cascade_method: fromFingerprint ? "fingerprint" : "rules",
        classification_manual: classificationManual,
        previous_classification: host.classification,
        previous_confidence: (host as { inferred_confidence?: number | null }).inferred_confidence ?? 0,
        trigger: "apply",
        force,
      });
      if (touchedClassification) {
        applied++;
      } else {
        skipped++;
      }
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
