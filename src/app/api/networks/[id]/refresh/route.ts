import { NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork, getDb, getFingerprintClassificationRulesForResolve } from "@/lib/db";
import { getCustomClassificationBySlug } from "@/lib/db-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { classifyDevice } from "@/lib/device-classifier";
import { getClassificationFromFingerprintSnapshot } from "@/lib/device-fingerprint-classification";
import type { DeviceFingerprintSnapshot } from "@/types";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { reverseDns, forwardDns } from "@/lib/scanner/dns";

type ClassificationProposal = {
  host_id: number;
  ip: string;
  hostname: string | null;
  current: string | null;
  proposed: string;
  reason: string;
  manual: boolean;
};

/**
 * POST /api/networks/[id]/refresh
 * - Default: applica subito classificazioni/DNS/vendor.
 * - { dryRun: true }: ritorna { proposals: [...] } senza scrivere.
 * - { force: true }: sovrascrive anche le classificazioni manuali.
 * - { forceDns: true }: ri-risolve DNS anche se già archiviato.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  // Bug fix audit 2026-05-26 (A1): senza withTenantFromSession getDb() cade su
  // tenant DEFAULT, scrivendo su data/tenants/DEFAULT.db indipendentemente
  // dall'utente loggato → cross-tenant corruption silente.
  return withTenantFromSession(async () => {
  try {
    const { id } = await params;
    const body = await _request.json().catch(() => ({})) as { force?: boolean; forceDns?: boolean; dryRun?: boolean };
    const forceReclassify = body.force === true;
    const forceDns = body.forceDns === true;
    const dryRun = body.dryRun === true;

    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    const hosts = getHostsByNetwork(Number(id));
    const db = getDb();
    const dnsServer = network.dns_server ?? null;
    const fpUserRules = getFingerprintClassificationRulesForResolve();

    let updated = 0;
    let reclassified = 0;
    let dnsUpdated = 0;
    let vendorUpdated = 0;
    const proposals: ClassificationProposal[] = [];

    for (const host of hosts) {
      const changes: string[] = [];
      const fields: string[] = ["updated_at = datetime('now')"];
      const values: unknown[] = [];

      // 1. Vendor da MAC (solo applicazione, non dryRun)
      if (!dryRun && host.mac) {
        const freshVendor = await lookupVendor(host.mac);
        if (freshVendor && freshVendor !== host.vendor) {
          fields.push("vendor = ?");
          values.push(freshVendor);
          changes.push("vendor");
          vendorUpdated++;
        }
      }

      // 2. DNS (solo applicazione, non dryRun — il dryRun si concentra sulla classificazione)
      let dnsReverse: string | null = host.dns_reverse;
      let dnsForward: string | null = host.dns_forward ?? null;
      if (!dryRun && (forceDns || !host.dns_reverse)) {
        dnsReverse = await reverseDns(host.ip, dnsServer);
        dnsForward = null;
        if (dnsReverse) {
          const forwardResults = await forwardDns(dnsReverse, dnsServer);
          dnsForward = forwardResults.includes(host.ip) ? dnsReverse : null;
        }
        if (dnsReverse !== host.dns_reverse) {
          fields.push("dns_reverse = ?");
          values.push(dnsReverse);
          changes.push("dns_reverse");
          dnsUpdated++;
        }
        if (dnsForward !== host.dns_forward) {
          fields.push("dns_forward = ?");
          values.push(dnsForward);
          changes.push("dns_forward");
        }
        const currentSource = (host as unknown as Record<string, unknown>).hostname_source as string | null;
        if (dnsReverse && (!host.hostname || !currentSource || currentSource === "dns")) {
          if (dnsReverse !== host.hostname) {
            fields.push("hostname = ?");
            values.push(dnsReverse);
            fields.push("hostname_source = ?");
            values.push("dns");
            changes.push("hostname");
          }
        }
      }

      // 3. Classificazione
      const classificationManual = (host as unknown as Record<string, unknown>).classification_manual === 1;
      if (!classificationManual || forceReclassify || dryRun) {
        let openPorts: Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }> | null = null;
        if (host.open_ports) {
          try { openPorts = JSON.parse(host.open_ports); } catch { /* ignore */ }
        }

        const effectiveVendor = values[values.length - 1] === host.vendor
          ? host.vendor
          : (changes.includes("vendor") ? values[fields.indexOf("vendor = ?")]  as string : host.vendor);

        let fpSnap: DeviceFingerprintSnapshot | null = null;
        if (host.detection_json) {
          try {
            fpSnap = JSON.parse(host.detection_json) as DeviceFingerprintSnapshot;
          } catch {
            /* ignore */
          }
        }
        const fromFingerprint = fpSnap ? getClassificationFromFingerprintSnapshot(fpSnap, fpUserRules) : undefined;
        const fromRules = classifyDevice({
          sysDescr: fpSnap?.snmp_sysdescr ?? host.os_info ?? null,
          sysObjectID: fpSnap?.snmp_vendor_oid ?? null,
          osInfo: host.os_info ?? null,
          openPorts,
          hostname: host.hostname ?? null,
          vendor: effectiveVendor ?? null,
        });
        const newClassification = fromFingerprint ?? fromRules;

        // Bug fix audit 2026-05-26 (A3): se la classification corrente è una
        // custom child del newClassification (es. host.classification="server_postgres"
        // con parent_slug="server" e classifier propone "server"), NON sovrascrivere:
        // la custom è più specifica del parent built-in. Altrimenti force=true
        // distrugge silenziosamente le sotto-categorie utente.
        const currentCustom = host.classification ? getCustomClassificationBySlug(host.classification) : undefined;
        const currentIsCustomChildOfNew = currentCustom?.parent_slug === newClassification;

        if (newClassification && newClassification !== host.classification && !currentIsCustomChildOfNew) {
          if (dryRun) {
            proposals.push({
              host_id: host.id,
              ip: host.ip,
              hostname: host.hostname ?? null,
              current: host.classification ?? null,
              proposed: newClassification,
              reason: fromFingerprint ? "fingerprint" : "regole",
              manual: classificationManual,
            });
          } else {
            fields.push("classification = ?");
            values.push(newClassification);
            if (forceReclassify && classificationManual) {
              fields.push("classification_manual = 0");
            }
            changes.push(`classification: ${host.classification} → ${newClassification}`);
            reclassified++;
          }
        }
      }

      // Applica update se ci sono cambiamenti e non siamo in dry-run
      if (!dryRun && values.length > 0) {
        values.push(host.id);
        db.prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
        updated++;
      }
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        total_hosts: hosts.length,
        proposals,
      });
    }

    return NextResponse.json({
      success: true,
      total_hosts: hosts.length,
      updated,
      reclassified,
      dns_updated: dnsUpdated,
      vendor_updated: vendorUpdated,
      message: `Aggiornati ${updated}/${hosts.length} host: ${reclassified} riclassificati, ${dnsUpdated} DNS aggiornati, ${vendorUpdated} vendor aggiornati`,
    });
  } catch (error) {
    console.error("Network refresh error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
      { status: 500 }
    );
  }
  });
}
