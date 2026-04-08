/**
 * Batch re-fingerprint di tutti gli host di una subnet.
 * Usa i dati già presenti in DB (nessuna scansione di rete).
 * Aggiorna detection_json e classification solo su host con classification_manual = 0.
 */

import { getTenantDb, getCurrentTenantCode, getHostsByNetwork } from "@/lib/db-tenant";
import { getEnabledDeviceFingerprintRules } from "@/lib/db-hub";
import { buildDeviceFingerprint } from "@/lib/scanner/device-fingerprint";
import { getClassificationFromFingerprintSnapshot } from "@/lib/device-fingerprint-classification";
import type { Host } from "@/types";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

export interface BatchRefingerPrintResult {
  processed: number;
  updated: number;
  errors: number;
}

function parseOpenPorts(openPortsJson: string | null): Array<{ port: number; protocol: string }> {
  if (!openPortsJson) return [];
  try {
    const arr = JSON.parse(openPortsJson);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p: unknown) => {
        if (typeof p === "number") return { port: p, protocol: "tcp" };
        if (typeof p === "object" && p !== null) {
          const o = p as { port?: number; protocol?: string };
          if (typeof o.port === "number") return { port: o.port, protocol: o.protocol ?? "tcp" };
        }
        return null;
      })
      .filter((p): p is { port: number; protocol: string } => p !== null);
  } catch {
    return [];
  }
}

function parseSnmpData(snmpDataJson: string | null): {
  sysDescr?: string | null;
  sysObjectID?: string | null;
  sysName?: string | null;
} {
  if (!snmpDataJson) return {};
  try {
    return JSON.parse(snmpDataJson) as { sysDescr?: string; sysObjectID?: string; sysName?: string };
  } catch {
    return {};
  }
}

function parseTtl(detectionJson: string | null): number | null {
  if (!detectionJson) return null;
  try {
    const snap = JSON.parse(detectionJson) as { ttl?: number | null };
    return snap.ttl ?? null;
  } catch {
    return null;
  }
}

/**
 * Processa gli host in sequenza (activeProbes: false = nessuna connessione di rete).
 */
export async function batchRefingerPrintAsync(networkId: number): Promise<BatchRefingerPrintResult> {
  const hosts = getHostsByNetwork(networkId);
  const rules = getEnabledDeviceFingerprintRules();

  let processed = 0;
  let updated = 0;
  let errors = 0;

  const updateStmt = db().prepare(
    `UPDATE hosts
     SET detection_json = ?, classification = ?, updated_at = datetime('now')
     WHERE id = ? AND classification_manual = 0`
  );

  for (const host of hosts) {
    processed++;
    try {
      const openPorts = parseOpenPorts((host as Host & { open_ports?: string | null }).open_ports ?? null);
      const snmp = parseSnmpData((host as Host & { snmp_data?: string | null }).snmp_data ?? null);
      const ttl = parseTtl((host as Host & { detection_json?: string | null }).detection_json ?? null);

      const snap = await buildDeviceFingerprint(
        {
          ip: host.ip,
          hostname: host.hostname ?? null,
          mac: host.mac ?? null,
          macVendor: host.vendor ?? null,
          ttl,
          openPorts,
          snmpSysDescr: snmp.sysDescr ?? null,
          snmpSysObjectID: snmp.sysObjectID ?? null,
          snmpSysName: snmp.sysName ?? null,
          activeProbes: false,
        },
        rules
      );

      const classification =
        getClassificationFromFingerprintSnapshot(snap) ?? host.classification ?? "unknown";

      const changed = updateStmt.run(JSON.stringify(snap), classification, host.id);
      if (changed.changes > 0) updated++;
    } catch {
      errors++;
    }
  }

  return { processed, updated, errors };
}
