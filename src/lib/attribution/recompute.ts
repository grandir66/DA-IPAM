import type Database from "better-sqlite3";
import { getActiveEvidence, recordEvidence, retireStaleEvidence } from "./evidence";
import { emitEvidenceFromSignals, RECOMPUTED_SOURCES } from "./emitters";
import type { AttributionSignals } from "./emitters";
import { fuseAttribution } from "./fuse";
import type { AttributionResult } from "./fuse";
import { applyAttribution } from "./persist";

/**
 * Fase 3b: emette le evidenze dai segnali già in DB e rifonde l'insieme
 * completo (spec §3: deterministica, non incrementale) SENZA persistere su
 * hosts.attr_* né in history. recordEvidence resta additivo (le evidenze
 * emesse vengono comunque scritte/aggiornate — solo l'applicazione del
 * risultato fuso viene saltata), quindi una preview seguita da un apply
 * produce lo stesso esito di un recompute diretto.
 *
 * Dopo recordEvidence, ritira (expires_at = now, non hard-delete) le evidenze
 * attive delle sorgenti RECOMPUTED_SOURCES che questa chiamata NON ha ri-emesso:
 * senza questo passo un claim che un emettitore smette di produrre (es. vendor
 * placeholder ora filtrato) resta attivo e continua a vincere la fusione per
 * sempre (gap trovato in produzione: 5 host bloccati sul vendor placeholder).
 */
export function previewHostAttribution(
  dbh: Database.Database,
  signals: AttributionSignals
): AttributionResult {
  const emitted = emitEvidenceFromSignals(signals);
  recordEvidence(dbh, signals.host.id, emitted);
  retireStaleEvidence(dbh, signals.host.id, emitted, RECOMPUTED_SOURCES);
  return fuseAttribution(getActiveEvidence(dbh, signals.host.id), new Date().toISOString());
}

/**
 * Orchestratore fase 1: emette le evidenze dai segnali già in DB, rifonde
 * l'insieme completo (spec §3: deterministica, non incrementale) e persiste.
 */
export function recomputeHostAttribution(
  dbh: Database.Database,
  signals: AttributionSignals,
  trigger: "scan" | "apply" | "manual" | "backfill" = "apply"
): AttributionResult {
  const result = previewHostAttribution(dbh, signals);
  applyAttribution(dbh, signals.host.id, result, trigger);
  return result;
}

/**
 * Snapshot dei segnali di un host per un handle DB esplicito (fix I2, review
 * fase 4): stessa query di db-tenant.ts::getAttributionSignalsForHost /
 * db.ts::getAttributionSignalsForHost, ma parametrizzata sull'handle passato
 * invece di risolverlo internamente — così NON dipende dall'AsyncLocalStorage
 * del tenant corrente. Tenere allineata a mano alle due facade (regola 12: se
 * cambia una, cambiano tutte e tre).
 */
function getAttributionSignalsFromHandle(
  dbh: Database.Database,
  hostId: number
): AttributionSignals | null {
  const host = dbh.prepare(
    `SELECT id, ip, mac, vendor, hostname, os_info, open_ports, snmp_data, detection_json
     FROM hosts WHERE id = ?`
  ).get(hostId) as AttributionSignals["host"] | undefined;
  if (!host) return null;
  const adComputer = dbh.prepare(
    `SELECT operating_system, operating_system_version FROM ad_computers
     WHERE host_id = ? ORDER BY synced_at DESC LIMIT 1`
  ).get(hostId) as AttributionSignals["adComputer"] ?? null;
  const wazuh = dbh.prepare(
    `SELECT wo.os_platform, wo.os_name, wo.os_version, wh.board_vendor
     FROM wazuh_agent wa
     LEFT JOIN wazuh_os wo ON wo.agent_id = wa.agent_id
     LEFT JOIN wazuh_hw wh ON wh.agent_id = wa.agent_id
     WHERE wa.host_id = ? LIMIT 1`
  ).get(hostId) as AttributionSignals["wazuh"] ?? null;
  const neighborSightings = dbh.prepare(
    `SELECT dn.protocol, dn.remote_platform, dn.remote_device_name
     FROM device_neighbors dn, hosts h
     WHERE h.id = ?
       AND ((dn.remote_mac IS NOT NULL AND dn.remote_mac = h.mac)
         OR (dn.remote_ip IS NOT NULL AND dn.remote_ip = h.ip))
     ORDER BY dn.timestamp DESC LIMIT 5`
  ).all(hostId) as AttributionSignals["neighborSightings"];
  return { host, adComputer, wazuh, neighborSightings };
}

/**
 * Variante di recomputeAttributionSafe che prende l'handle DB già risolto dal
 * chiamante invece di ririsolverlo da getCurrentTenantCode() (fix I2, review
 * fase 4): db.ts::getDb() fa fallback al tenant DEFAULT quando non c'è un
 * contesto AsyncLocalStorage attivo, ma recomputeAttributionSafe falliva
 * silenziosamente in quello stesso scenario (getCurrentTenantCode() → null),
 * perdendo l'attribuzione senza che nessuno se ne accorgesse. Usare questa
 * variante ovunque l'handle sia già disponibile (es. db.ts, che lo risolve
 * comunque per fare l'upsert stesso) invece di ririsolvere il tenant da zero.
 * Stesso contratto di recomputeAttributionSafe: non propaga mai errori.
 */
export function recomputeAttributionForDb(
  dbh: Database.Database,
  hostId: number,
  trigger: "scan" | "apply" | "manual" | "backfill" = "scan"
): AttributionResult | null {
  try {
    const signals = getAttributionSignalsFromHandle(dbh, hostId);
    if (!signals) return null;
    return recomputeHostAttribution(dbh, signals, trigger);
  } catch (e) {
    console.error(`[attribution] recompute host ${hostId} fallito (recomputeAttributionForDb):`, e);
    return null;
  }
}

/**
 * Wrapper per gli hook nei flussi esistenti (scan, sync, cron) che NON hanno
 * già un handle DB a portata di mano: risolve il contesto tenant corrente via
 * AsyncLocalStorage e delega a recomputeAttributionForDb. NON propaga mai
 * errori — un difetto del motore di attribuzione non deve rompere scansioni
 * o sync.
 *
 * ATTENZIONE (fix I2): se il chiamante gira FUORI da un contesto tenant
 * esplicito (withTenant/withTenantFromSession) — es. db.ts::upsertHost quando
 * getDb() è caduto sul fallback DEFAULT — questa funzione ritorna null senza
 * fare nulla, perché getCurrentTenantCode() non vede quel fallback. In quei
 * punti usare recomputeAttributionForDb(dbh, hostId, trigger) passando
 * esplicitamente l'handle già risolto dal chiamante, non questa funzione.
 */
export function recomputeAttributionSafe(
  hostId: number,
  trigger: "scan" | "apply" | "manual" | "backfill" = "scan"
): AttributionResult | null {
  try {
    // import dinamico per evitare cicli db-tenant ↔ attribution
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentTenantCode, getTenantDb } = require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (!code) return null;
    return recomputeAttributionForDb(getTenantDb(code), hostId, trigger);
  } catch (e) {
    console.error(`[attribution] recompute host ${hostId} fallito:`, e);
    return null;
  }
}
