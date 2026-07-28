import type Database from "better-sqlite3";
import type { AttributionResult } from "./fuse";
import { projectLegacy } from "./legacy-projection";

interface CurrentAttrRow {
  attr_vendor: string | null;
  attr_vendor_name: string | null;
  attr_category: string | null;
  attr_os_family: string | null;
  attr_os_name: string | null;
  attr_confidence_vendor: number | null;
  attr_confidence_category: number | null;
  attr_confidence_os: number | null;
  attr_min_phase: string | null;
}

/** Colonne legacy lette nella STESSA SELECT del guard "invariato" (niente query extra):
 * servono sia per il lock manuale sia per il confronto "il valore è cambiato davvero". */
interface CurrentLegacyRow {
  classification_manual: number;
  classification: string | null;
  inferred_device_type: string | null;
  inferred_vendor: string | null;
  inferred_os_family: string | null;
  inferred_confidence: number | null;
}

/** null e undefined sono equivalenti ai fini del confronto "nessun cambiamento". */
function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

/**
 * Scrive il risultato della fusione su hosts.attr_* e appende alla history estesa.
 * Fase 4: proietta anche il risultato sulle colonne legacy (classification/inferred_*)
 * via `projectLegacy`, rispettando SEMPRE il lock manuale (classification_manual=1
 * non viene mai toccato) — vedi legacy-projection.ts per le regole di ricomposizione.
 * Il trigger riusa i valori del CHECK esistente (decisione 8 del piano).
 *
 * Salta UPDATE + INSERT history se il risultato è identico a quanto già persistito
 * (write amplification: gli hook ARP/DHCP/Wazuh/AD/discovery ricomputano gli stessi
 * host più volte per flusso).
 *
 * @returns true se ha scritto (cambiamento reale), false se il risultato era invariato.
 */
export function applyAttribution(
  dbh: Database.Database,
  hostId: number,
  result: AttributionResult,
  trigger: "scan" | "apply" | "manual" | "backfill"
): boolean {
  const current = dbh.prepare(
    `SELECT attr_vendor, attr_vendor_name, attr_category, attr_os_family, attr_os_name,
            attr_confidence_vendor, attr_confidence_category, attr_confidence_os, attr_min_phase,
            classification_manual, classification,
            inferred_device_type, inferred_vendor, inferred_os_family, inferred_confidence
     FROM hosts WHERE id = ?`
  ).get(hostId) as (CurrentAttrRow & CurrentLegacyRow) | undefined;

  const next: CurrentAttrRow = {
    attr_vendor: result.vendor.claim,
    attr_vendor_name: result.vendor.vendor_name,
    attr_category: result.category.claim,
    attr_os_family: result.os.claim,
    attr_os_name: result.os.os_name,
    attr_confidence_vendor: result.vendor.confidence,
    attr_confidence_category: result.category.confidence,
    attr_confidence_os: result.os.confidence,
    attr_min_phase: result.category.min_phase,
  };

  const unchanged = current !== undefined
    && (Object.keys(next) as Array<keyof CurrentAttrRow>).every((k) => norm(current[k]) === norm(next[k]));
  if (unchanged) return false;

  dbh.transaction(() => {
    dbh.prepare(
      `UPDATE hosts SET
         attr_vendor = ?, attr_vendor_name = ?, attr_category = ?,
         attr_os_family = ?, attr_os_name = ?,
         attr_confidence_vendor = ?, attr_confidence_category = ?, attr_confidence_os = ?,
         attr_min_phase = ?, attr_at = datetime('now'), attr_engine_version = ?
       WHERE id = ?`
    ).run(
      result.vendor.claim, result.vendor.vendor_name, result.category.claim,
      result.os.claim, result.os.os_name,
      result.vendor.confidence, result.category.confidence, result.os.confidence,
      result.category.min_phase, result.engine_version, hostId
    );
    dbh.prepare(
      `INSERT INTO host_classification_history
         (host_id, classification, confidence, reason, evidence_json, conflicts_json, attr_vendor, attr_category, attr_os, trigger)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      hostId, result.category.confidence,
      `attribution-v2 ${result.engine_version}`,
      JSON.stringify({ vendor: result.vendor.evidence_ids, category: result.category.evidence_ids, os: result.os.evidence_ids }),
      JSON.stringify(result.category.conflicts),
      result.vendor.claim, result.category.claim, result.os.claim, trigger
    );

    // Proiezione legacy (fase 4): hosts.classification/inferred_* diventano una
    // proiezione della fusione. Invariante SACRO: classification_manual=1 non va
    // mai toccato (l'utente ha fissato la classificazione a mano). `current` è
    // già stato letto sopra nella stessa SELECT del guard "invariato": niente
    // query extra.
    if (current && current.classification_manual === 0) {
      const projection = projectLegacy(result);
      // Regola uniforme per ogni colonna legacy: si scrive SOLO se il valore
      // proiettato non è null E differisce da quello attuale.
      // - Per `classification` questo implementa esplicitamente "se la proiezione
      //   è null, non azzerare il valore preesistente" (meglio un dato vecchio
      //   che nessun dato).
      // - Per inferred_device_type/inferred_vendor/inferred_os_family applichiamo
      //   la stessa cautela per simmetria (non c'è motivo di essere più
      //   aggressivi lì che su `classification`).
      // - inferred_confidence è un number (mai null): la condizione "non nullo"
      //   è sempre vera, quindi per quella colonna la regola si riduce a "scrivi
      //   se cambiata" — coerente con l'indicazione che ora è la proiezione a
      //   possederla in via esclusiva.
      const candidates: Array<[column: string, value: string | number | null, currentValue: string | number | null]> = [
        ["classification", projection.classification, current.classification],
        ["inferred_device_type", projection.inferred_device_type, current.inferred_device_type],
        ["inferred_vendor", projection.inferred_vendor, current.inferred_vendor],
        ["inferred_os_family", projection.inferred_os_family, current.inferred_os_family],
        ["inferred_confidence", projection.inferred_confidence, current.inferred_confidence],
      ];
      const toWrite = candidates.filter(([, value, currentValue]) => value !== null && value !== currentValue);
      if (toWrite.length > 0) {
        const setClause = toWrite.map(([column]) => `${column} = ?`).join(", ");
        dbh.prepare(`UPDATE hosts SET ${setClause} WHERE id = ?`).run(
          ...toWrite.map(([, value]) => value), hostId
        );
      }
    }
  })();
  return true;
}
