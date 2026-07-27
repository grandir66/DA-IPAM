import type Database from "better-sqlite3";
import type { AttributionEvidenceRow, AttributionSource, EvidenceInput } from "./types";
import { ATTR_SOURCE_WEIGHTS } from "./weights";

export interface RecordEvidenceResult { inserted: number; refreshed: number; superseded: number; }

/**
 * Registra evidenze per un host (spec §4.2, decisione 10 del piano):
 * - identica a una attiva (source, dimension, claim, raw_value) → refresh di
 *   observed_at/confidence/expires_at;
 * - claim/raw diverso dalla stessa (source, dimension) → INSERT + supersede
 *   delle attive precedenti di quella coppia;
 * - le evidenze manual sono superseded SOLO da un nuovo manual;
 * - claim DIVERSI co-emessi dalla STESSA (source, dimension) nello STESSO batch
 *   (es. mdns che emette sia category=storage.nas sia category=compute per lo
 *   stesso host — caso reale QNAP 192.168.40.26) NON si superseded a vicenda:
 *   il supersede per una coppia (source, dimension) viene calcolato una sola
 *   volta, dopo aver processato tutti i claim del batch per quella coppia.
 */
export function recordEvidence(
  dbh: Database.Database,
  hostId: number,
  inputs: EvidenceInput[]
): RecordEvidenceResult {
  const result: RecordEvidenceResult = { inserted: 0, refreshed: 0, superseded: 0 };
  const selActive = dbh.prepare(
    `SELECT id, claim, raw_value FROM attribution_evidence
     WHERE host_id = ? AND source = ? AND dimension = ? AND superseded_by IS NULL`
  );
  const refresh = dbh.prepare(
    `UPDATE attribution_evidence
     SET observed_at = datetime('now'), confidence = ?, expires_at = ? WHERE id = ?`
  );
  const insert = dbh.prepare(
    `INSERT INTO attribution_evidence
       (host_id, source, phase, dimension, claim, confidence, weight, raw_value, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const supersede = dbh.prepare(`UPDATE attribution_evidence SET superseded_by = ? WHERE id = ?`);

  // Raggruppa gli input per coppia (source, dimension): il supersede va calcolato
  // una volta per l'intero gruppo, dopo aver processato tutti i claim del batch,
  // cosi' i claim co-emessi nello stesso batch non si cancellano a vicenda.
  // retireStaleEvidence resta responsabile del ritiro per assenza dall'insieme
  // emesso su batch successivi; qui si evita solo l'auto-cancellazione dentro il
  // batch corrente.
  const groups = new Map<string, EvidenceInput[]>();
  for (const input of inputs) {
    const key = `${input.source} ${input.dimension}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(input);
  }

  dbh.transaction(() => {
    for (const groupInputs of groups.values()) {
      const { source, dimension } = groupInputs[0];
      const active = selActive.all(hostId, source, dimension) as Array<{
        id: number; claim: string; raw_value: string | null;
      }>;
      const activeByClaim = new Map(active.map((a) => [a.claim, a] as const));

      // id "vincitore" per ciascun claim del batch (riga refreshata in place o
      // nuova riga inserita), piu' un id di fallback per il supersede delle righe
      // stale (claim non piu' emesso in questo batch da questa source/dimension).
      const winnerIdByClaim = new Map<string, number>();
      let lastWinnerId: number | null = null;
      for (const input of groupInputs) {
        const weight = input.weight ?? ATTR_SOURCE_WEIGHTS[input.source];
        const existing = activeByClaim.get(input.claim);
        const identical =
          existing !== undefined && (existing.raw_value ?? null) === (input.raw_value ?? null);
        if (identical) {
          refresh.run(input.confidence, input.expires_at ?? null, existing.id);
          result.refreshed += 1;
          winnerIdByClaim.set(input.claim, existing.id);
          lastWinnerId = existing.id;
          continue;
        }
        const newId = insert.run(
          hostId, input.source, input.phase, input.dimension, input.claim,
          input.confidence, weight, input.raw_value ?? null, input.expires_at ?? null
        ).lastInsertRowid as number;
        result.inserted += 1;
        winnerIdByClaim.set(input.claim, newId);
        lastWinnerId = newId;
      }

      // Supersede delle righe attive preesistenti che non sono il "vincitore" del
      // proprio claim in questo batch: copre sia i claim assenti dal batch (stale),
      // sia un claim ri-emesso con raw_value diverso (la nuova riga sostituisce la
      // vecchia). I claim co-emessi il cui esito e' un refresh in place restano
      // intatti perche' coincidono col proprio vincitore (stesso id).
      for (const a of active) {
        const winnerId = winnerIdByClaim.get(a.claim);
        if (winnerId === a.id) continue;
        supersede.run(winnerId ?? lastWinnerId, a.id);
        result.superseded += 1;
      }
    }
  })();
  return result;
}

export function getActiveEvidence(
  dbh: Database.Database,
  hostId: number
): AttributionEvidenceRow[] {
  return dbh
    .prepare(
      `SELECT * FROM attribution_evidence
       WHERE host_id = ? AND superseded_by IS NULL
       ORDER BY dimension, source, id`
    )
    .all(hostId) as AttributionEvidenceRow[];
}

/**
 * Ritiro morbido delle evidenze non più prodotte da un recompute (gap ciclo di vita,
 * trovato in produzione: un emettitore che smette di emettere un claim — es. vendor
 * placeholder ora filtrato — lasciava la vecchia riga attiva a vincere per sempre la
 * fusione). Per ogni riga ATTIVA ai fini della fusione (superseded_by IS NULL,
 * expires_at NULL o futura) dell'host la cui source è tra `sources`: se `emitted` non
 * contiene una entry con la stessa (source, dimension, claim), la riga viene ritirata
 * impostando `expires_at = now` — resta in storia (superseded_by resta NULL), ma
 * `fuseAttribution` la esclude (stesso filtro usato per le evidenze con TTL).
 *
 * Ritiro morbido, non hard-delete/supersede: se in futuro l'emettitore ri-produce lo
 * stesso claim, `recordEvidence` la trova già "attiva" (la sua select ignora
 * expires_at, guarda solo superseded_by) e la rianima via il refresh path
 * (`expires_at = input.expires_at ?? null`), senza bisogno di logica dedicata qui.
 *
 * `source='manual'` non viene MAI ritirata (guardia esplicita, indipendente da
 * `sources`): un valore impostato a mano non deve sparire perché un emettitore
 * automatico ha smesso di confermarlo.
 */
export function retireStaleEvidence(
  dbh: Database.Database,
  hostId: number,
  emitted: EvidenceInput[],
  sources: readonly AttributionSource[]
): number {
  const candidateSources = sources.filter((s) => s !== "manual");
  if (candidateSources.length === 0) return 0;

  const placeholders = candidateSources.map(() => "?").join(",");
  const active = dbh.prepare(
    `SELECT id, source, dimension, claim FROM attribution_evidence
     WHERE host_id = ? AND superseded_by IS NULL
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       AND source != 'manual'
       AND source IN (${placeholders})`
  ).all(hostId, ...candidateSources) as Array<{ id: number; source: string; dimension: string; claim: string }>;
  if (active.length === 0) return 0;

  const emittedKeys = new Set(emitted.map((e) => `${e.source} ${e.dimension} ${e.claim}`));
  const retire = dbh.prepare(`UPDATE attribution_evidence SET expires_at = datetime('now') WHERE id = ?`);

  let retired = 0;
  dbh.transaction(() => {
    for (const row of active) {
      const key = `${row.source} ${row.dimension} ${row.claim}`;
      if (!emittedKeys.has(key)) {
        retire.run(row.id);
        retired += 1;
      }
    }
  })();
  return retired;
}
