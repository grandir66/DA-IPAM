import type Database from "better-sqlite3";
import type { DeviceFingerprintSnapshot } from "@/types";
import { normalizeToEvidence } from "./normalize";
import { decideClassification } from "./engine";
import { applyClassificationDecision } from "./persist";
import type { ClassificationDecision } from "./types";

export type SqliteDbLike = Database.Database;

function portsToNumbers(
  open_ports?: Array<{ port: number }> | number[] | null
): number[] {
  if (!open_ports?.length) return [];
  return open_ports
    .map((p) => (typeof p === "number" ? p : p.port))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/**
 * Facade post-cascade: normalize → decide → persist.
 * Cascade slug/method restano input; la policy decide se toccare `classification`.
 */
export async function runClassificationEngineForHost(args: {
  db: SqliteDbLike;
  hostId: number;
  ip: string;
  hostname?: string | null;
  vendor?: string | null;
  os_info?: string | null;
  open_ports?: Array<{ port: number }> | number[] | null;
  detection: DeviceFingerprintSnapshot | null;
  snmp_sysdescr?: string | null;
  snmp_sysobjectid?: string | null;
  naabu_ports?: number[] | null;
  cascade_slug?: string | null;
  cascade_method?: string | null;
  classification_manual: boolean;
  previous_classification: string | null;
  previous_confidence: number | null;
  trigger: "scan" | "apply" | "manual" | "backfill";
  force?: boolean;
}): Promise<ClassificationDecision> {
  const evidence = normalizeToEvidence({
    ip: args.ip,
    hostname: args.hostname ?? null,
    vendor: args.vendor ?? null,
    os_info: args.os_info ?? null,
    open_ports: portsToNumbers(args.open_ports),
    snmp_sysdescr: args.snmp_sysdescr ?? null,
    snmp_sysobjectid: args.snmp_sysobjectid ?? null,
    detection: args.detection,
    naabu_ports: args.naabu_ports,
    cascade_slug: args.cascade_slug,
    cascade_method: args.cascade_method,
  });

  const decision = decideClassification(evidence, {
    cascade_slug: args.cascade_slug,
    previous_classification: args.previous_classification,
    previous_confidence: args.previous_confidence,
    classification_manual: args.classification_manual,
  });

  applyClassificationDecision(args.db, args.hostId, decision, {
    classification_manual: args.classification_manual,
    previous_classification: args.previous_classification,
    previous_confidence: args.previous_confidence,
    trigger: args.trigger,
    force: args.force,
  });

  return decision;
}
