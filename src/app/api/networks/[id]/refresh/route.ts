import { NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork, getDb } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { classifyDevice } from "@/lib/device-classifier";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { reverseDns, forwardDns } from "@/lib/scanner/dns";

/**
 * POST /api/networks/[id]/refresh
 * Ricalcola classificazioni, DNS, vendor per tutti gli host della rete.
 * Non esegue scan attivi (ping/nmap) — usa i dati già presenti nel DB.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  try {
    const { id } = await params;
    const body = await _request.json().catch(() => ({})) as { force?: boolean };
    const forceReclassify = body.force === true;

    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    const hosts = getHostsByNetwork(Number(id));
    const db = getDb();
    const dnsServer = network.dns_server ?? null;

    let updated = 0;
    let reclassified = 0;
    let dnsUpdated = 0;
    let vendorUpdated = 0;

    for (const host of hosts) {
      const changes: string[] = [];
      const fields: string[] = ["updated_at = datetime('now')"];
      const values: unknown[] = [];

      // 1. Ricalcola vendor da MAC (se MAC presente e vendor vuoto o cambiato)
      if (host.mac) {
        const freshVendor = await lookupVendor(host.mac);
        if (freshVendor && freshVendor !== host.vendor) {
          fields.push("vendor = ?");
          values.push(freshVendor);
          changes.push("vendor");
          vendorUpdated++;
        }
      }

      // 2. Reverse DNS — sempre ricalcolato
      const dnsReverse = await reverseDns(host.ip, dnsServer);
      if (dnsReverse) {
        if (dnsReverse !== host.dns_reverse) {
          fields.push("dns_reverse = ?");
          values.push(dnsReverse);
          changes.push("dns_reverse");
          dnsUpdated++;
        }

        // Forward DNS — verifica bidirezionale
        const forwardResults = await forwardDns(dnsReverse, dnsServer);
        const dnsForward = forwardResults.includes(host.ip) ? dnsReverse : null;
        if (dnsForward !== host.dns_forward) {
          fields.push("dns_forward = ?");
          values.push(dnsForward);
          changes.push("dns_forward");
        }

        // Se non c'è hostname o hostname_source è "dns" o assente, aggiorna hostname
        const currentSource = (host as unknown as Record<string, unknown>).hostname_source as string | null;
        if (!host.hostname || !currentSource || currentSource === "dns") {
          if (dnsReverse !== host.hostname) {
            fields.push("hostname = ?");
            values.push(dnsReverse);
            fields.push("hostname_source = ?");
            values.push("dns");
            changes.push("hostname");
          }
        }
      }

      // 3. Ricalcola classificazione con le regole aggiornate
      const classificationManual = (host as unknown as Record<string, unknown>).classification_manual === 1;
      if (!classificationManual || forceReclassify) {
        let openPorts: Array<{ port: number; protocol?: string; service?: string | null; version?: string | null }> | null = null;
        if (host.open_ports) {
          try { openPorts = JSON.parse(host.open_ports); } catch { /* ignore */ }
        }

        const effectiveVendor = values[values.length - 1] === host.vendor
          ? host.vendor
          : (changes.includes("vendor") ? values[fields.indexOf("vendor = ?")]  as string : host.vendor);

        const newClassification = classifyDevice({
          sysDescr: host.os_info ?? null,
          osInfo: host.os_info ?? null,
          openPorts,
          hostname: host.hostname ?? null,
          vendor: effectiveVendor ?? null,
        });

        if (newClassification && newClassification !== host.classification) {
          fields.push("classification = ?");
          values.push(newClassification);
          if (forceReclassify && classificationManual) {
            fields.push("classification_manual = 0");
          }
          changes.push(`classification: ${host.classification} → ${newClassification}`);
          reclassified++;
        }
      }

      // Applica update se ci sono cambiamenti
      if (values.length > 0) {
        values.push(host.id);
        db.prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
        updated++;
      }
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
}
