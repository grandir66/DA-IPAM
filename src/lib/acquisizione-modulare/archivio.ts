/**
 * Archivio degli snapshot (C1.3, D5): JSON validato dallo schema 1.0, compresso con gzip, impronta SHA-256 del JSON non
 * compresso (identifica, non protegge). Rifiuta di scrivere ciò che non passa lo schema o che contiene uno dei segreti
 * usati per la lettura: un collector che dimenticasse la redazione non porta mai un segreto nel DB.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { snapshotSchema, type AcquisitionSnapshot } from "@/lib/acquisition";
import { inserisciSnapshotAcquisizione, leggiSnapshotAcquisizione, type SnapshotAcquisizioneRiga } from "@/lib/db-tenant";

/** Le voci d'archivio usate, per protocollo: solo id e nome, mai segreti. */
export type CredenzialiUsate = Partial<Record<"ssh" | "snmp" | "api" | "winrm", { credential_id: number | null; nome: string }>>;

export interface OpzioniSalvataggio {
  credenziali: CredenzialiUsate;
  utente: { id: number | null; nome: string | null } | null;
  /** I segreti della richiesta: se uno compare nel JSON lo snapshot non si salva. */
  segreti?: readonly string[];
  trigger?: string;
}

const SEZIONI_CON_STATO = (s: AcquisitionSnapshot): Record<string, string> =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v && typeof v === "object" && "status" in (v as object))
    .map(([k, v]) => [k, (v as { status: string }).status]));

export function salvaSnapshot(deviceId: number, snapshot: AcquisitionSnapshot, o: OpzioniSalvataggio): number {
  const valido = snapshotSchema.parse(snapshot);
  const json = JSON.stringify(valido);
  for (const s of o.segreti ?? []) if (s && json.includes(s)) throw new Error("SNAPSHOT_CON_SEGRETO");
  const payload = gzipSync(Buffer.from(json, "utf8"));
  const sezioni = Object.entries(valido).filter(([, v]) => v && typeof v === "object" && "warnings" in (v as object));
  const avvisi = sezioni.reduce((n, [, v]) => n + ((v as { warnings: string[] }).warnings.length), 0);
  const inizio = new Date(valido.collected_at);
  return inserisciSnapshotAcquisizione({
    device_id: deviceId,
    collector: valido.collector,
    collector_version: valido.collector_version,
    schema_version: valido.schema_version,
    started_at: inizio.toISOString(),
    finished_at: new Date(inizio.getTime() + Math.round(valido.duration_ms)).toISOString(),
    duration_ms: Math.round(valido.duration_ms),
    status: valido.status,
    section_status: JSON.stringify(SEZIONI_CON_STATO(valido)),
    warning_count: avvisi,
    credenziali: JSON.stringify(o.credenziali),
    requested_by: o.utente?.id ?? null,
    requested_by_name: o.utente?.nome ?? null,
    trigger: o.trigger ?? "manual",
    payload,
    payload_bytes: Buffer.byteLength(json),
    payload_gzip_bytes: payload.length,
    sha256: createHash("sha256").update(json).digest("hex"),
  });
}

export type LetturaSnapshot =
  | { ok: true; riga: SnapshotAcquisizioneRiga; snapshot: AcquisitionSnapshot }
  | { ok: false; motivo: string; status: 404 | 500 };

/** Uno snapshot decompresso e rivalidato. Un payload guasto è un errore detto, mai un riquadro vuoto. */
export function leggiPayload(deviceId: number, snapshotId: number): LetturaSnapshot {
  const r = leggiSnapshotAcquisizione(deviceId, snapshotId);
  if (!r) return { ok: false, motivo: "Snapshot non trovato", status: 404 };
  const { payload, ...riga } = r;
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(gunzipSync(payload).toString("utf8"));
  } catch {
    return { ok: false, motivo: "Snapshot illeggibile (payload guasto)", status: 500 };
  }
  const v = snapshotSchema.safeParse(grezzo);
  if (!v.success) return { ok: false, motivo: "Snapshot non conforme allo schema 1.0", status: 500 };
  return { ok: true, riga, snapshot: v.data };
}
