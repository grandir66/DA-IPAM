/**
 * Matcher CVE → riga software_inventory.
 *
 * Strategia in cascata (prima match vince per host):
 *   1. wazuh-package (confidence 0.9) — match diretto via wazuh_vuln.package_name
 *      sulle righe software_inventory dell'ultimo scan ok dell'host.
 *   2. dictionary (confidence 0.8) — lookup esatto dictionary su software_inventory.
 *   3. manual (confidence 1.0) — set via UI dall'admin. MAI sovrascritto.
 *   4. name-fuzzy (confidence 0.5) — Levenshtein ≤2 sul dictionary. Fallback.
 *
 * persistMatches è idempotente: UPSERT su (cve_id, software_id). Le righe con
 * match_strategy='manual' non vengono mai sovrascritte da strategie automatiche.
 */
import type Database from "better-sqlite3";
import { lookupExact, lookupFuzzy, normalizeSoftwareName } from "./dictionary";

export type MatchStrategy =
  | "wazuh-package"
  | "dictionary"
  | "manual"
  | "name-fuzzy";

export interface CveMatchResult {
  cveId: string;
  softwareId: number;
  chocoId: string | null;
  fixVersion: string | null;
  matchStrategy: MatchStrategy;
  confidence: number;
}

interface WazuhRow {
  cve: string;
  package_name: string;
  package_version: string | null;
}

interface SoftwareRow {
  id: number;
  name: string;
  version: string | null;
}

/**
 * Calcola i candidati di match per una CVE su un host.
 *
 * Non scrive nulla: ritorna solo i risultati. La persistenza è separata
 * (persistMatches) per permettere dry-run / preview futura.
 *
 * @param db DB tenant aperto (better-sqlite3)
 * @param cveId es. "CVE-2024-12345"
 * @param hostId hosts.id del tenant
 */
export function matchCveToSoftware(
  db: Database.Database,
  cveId: string,
  hostId: number
): CveMatchResult[] {
  const results: CveMatchResult[] = [];

  // ── 1. Layer Wazuh: cerca in wazuh_vuln la CVE per quell'host (via wazuh_agent.host_id)
  //    Se ha un package_name, prova a trovare la riga software_inventory che lo rappresenta.
  let wazuhRows: WazuhRow[] = [];
  try {
    wazuhRows = db
      .prepare(
        `SELECT wv.cve, wv.package_name, wv.package_version
         FROM wazuh_vuln wv
         INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
         WHERE wv.cve = ? AND wa.host_id = ? AND wv.package_name IS NOT NULL AND wv.package_name <> ''`
      )
      .all(cveId, hostId) as WazuhRow[];
  } catch (err) {
    // Se wazuh non è installato nel tenant le tabelle potrebbero non esistere:
    // continua silenziosamente alla strategia successiva.
    console.warn("[patch/matcher] wazuh_vuln query failed (forse modulo OFF):", err);
    wazuhRows = [];
  }

  const seen = new Set<number>();

  for (const w of wazuhRows) {
    const swNormalized = normalizeSoftwareName(w.package_name);
    if (!swNormalized) continue;

    // Cerca match LIKE sul name normalizzato nell'ultimo scan ok dell'host.
    // Limit 5 per evitare amplification: in pratica 1-2 match per package.
    const swRows = db
      .prepare(
        `SELECT si.id, si.name, si.version
         FROM software_inventory si
         INNER JOIN software_scans ss ON ss.id = si.scan_id
         WHERE ss.host_id = ? AND ss.status = 'ok' AND LOWER(si.name) LIKE ?
         ORDER BY ss.finished_at DESC
         LIMIT 5`
      )
      .all(hostId, `%${swNormalized.replace(/[%_]/g, "")}%`) as SoftwareRow[];

    for (const sw of swRows) {
      if (seen.has(sw.id)) continue;
      seen.add(sw.id);
      const dict = lookupExact(sw.name);
      results.push({
        cveId,
        softwareId: sw.id,
        chocoId: dict?.choco ?? null,
        fixVersion: null, // Wazuh API non espone fix_version dirette qui; opzionale in F5
        matchStrategy: "wazuh-package",
        confidence: 0.9,
      });
    }
  }

  // ── 2. Se nessun match Wazuh: prova dictionary diretto sull'inventory dell'host.
  //    Prendi tutto l'inventory dell'ultimo scan ok e cerca il primo match esatto.
  if (results.length === 0) {
    const allSoftware = db
      .prepare(
        `SELECT si.id, si.name
         FROM software_inventory si
         INNER JOIN software_scans ss ON ss.id = si.scan_id
         WHERE ss.host_id = ? AND ss.status = 'ok'
         ORDER BY ss.finished_at DESC`
      )
      .all(hostId) as Array<{ id: number; name: string }>;

    // Primo match esatto vince (deterministico nel ordine restituito).
    for (const sw of allSoftware) {
      if (seen.has(sw.id)) continue;
      const exact = lookupExact(sw.name);
      if (exact) {
        seen.add(sw.id);
        results.push({
          cveId,
          softwareId: sw.id,
          chocoId: exact.choco,
          fixVersion: null,
          matchStrategy: "dictionary",
          confidence: 0.8,
        });
        break;
      }
    }

    // ── 3. Fallback fuzzy SOLO se ancora nulla: Levenshtein ≤2 sul dict.
    if (results.length === 0) {
      for (const sw of allSoftware) {
        if (seen.has(sw.id)) continue;
        const fuzzy = lookupFuzzy(sw.name, 2);
        if (fuzzy) {
          seen.add(sw.id);
          results.push({
            cveId,
            softwareId: sw.id,
            chocoId: fuzzy.choco,
            fixVersion: null,
            matchStrategy: "name-fuzzy",
            confidence: 0.5,
          });
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Persisti i match in patch_cve_target con UPSERT idempotente.
 *
 * Regola critica: una riga con `match_strategy='manual'` NON viene mai
 * sovrascritta dalle altre strategie. L'admin ha autorità finale.
 *
 * Ritorna il numero di righe inserite/aggiornate.
 */
export function persistMatches(
  db: Database.Database,
  results: CveMatchResult[]
): number {
  if (!results.length) return 0;
  const stmt = db.prepare(
    `INSERT INTO patch_cve_target
       (cve_id, software_id, match_strategy, confidence, fix_package_manager, fix_package_id, fix_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(cve_id, software_id) DO UPDATE SET
       match_strategy = CASE WHEN patch_cve_target.match_strategy = 'manual'
                             THEN patch_cve_target.match_strategy
                             ELSE excluded.match_strategy END,
       confidence = CASE WHEN patch_cve_target.match_strategy = 'manual'
                         THEN patch_cve_target.confidence
                         ELSE excluded.confidence END,
       fix_package_manager = CASE WHEN patch_cve_target.match_strategy = 'manual'
                                  THEN patch_cve_target.fix_package_manager
                                  ELSE excluded.fix_package_manager END,
       fix_package_id = CASE WHEN patch_cve_target.match_strategy = 'manual'
                             THEN patch_cve_target.fix_package_id
                             ELSE excluded.fix_package_id END,
       fix_version = CASE WHEN patch_cve_target.match_strategy = 'manual'
                          THEN patch_cve_target.fix_version
                          ELSE excluded.fix_version END`
  );
  const tx = db.transaction((rows: CveMatchResult[]) => {
    let n = 0;
    for (const r of rows) {
      stmt.run(
        r.cveId,
        r.softwareId,
        r.matchStrategy,
        r.confidence,
        r.chocoId ? "choco" : null,
        r.chocoId,
        r.fixVersion
      );
      n++;
    }
    return n;
  });
  return tx(results);
}

/**
 * Esegui matcher + persist per una CVE su tutti gli host vulnerabili.
 *
 * "Host vulnerabili" = quelli con almeno un finding (wazuh_vuln o vuln_findings)
 * per quella CVE. Idempotente. NON sovrascrive le righe `manual`.
 *
 * Ritorna il numero di righe scritte.
 */
export function rematchCveForAllHosts(
  db: Database.Database,
  cveId: string
): number {
  // Unione host_id da wazuh_vuln e vuln_findings (modulo VA scanner-edge).
  const hostIds = new Set<number>();

  try {
    const wazuhHosts = db
      .prepare(
        `SELECT DISTINCT wa.host_id
         FROM wazuh_vuln wv
         INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
         WHERE wv.cve = ? AND wa.host_id IS NOT NULL`
      )
      .all(cveId) as Array<{ host_id: number }>;
    for (const r of wazuhHosts) hostIds.add(r.host_id);
  } catch {
    // wazuh OFF nel tenant: skip silenzioso
  }

  try {
    const vulnHosts = db
      .prepare(
        `SELECT DISTINCT host_id FROM vuln_findings
         WHERE cve_id = ? AND host_id IS NOT NULL`
      )
      .all(cveId) as Array<{ host_id: number }>;
    for (const r of vulnHosts) hostIds.add(r.host_id);
  } catch {
    // vuln_findings non presente: skip
  }

  let total = 0;
  for (const hostId of hostIds) {
    const matches = matchCveToSoftware(db, cveId, hostId);
    total += persistMatches(db, matches);
  }
  return total;
}

export interface FullSyncResult {
  softwareWithChoco: number; // righe patch_software_meta scritte/aggiornate (escluse 'manual')
  cveTargetsWritten: number; // righe patch_cve_target scritte/aggiornate (escluse 'manual')
  durationMs: number;
}

// Throttle in-memory per maybeRunLazyMatch (per tenant). Evita doppi run consecutivi
// quando l'utente naviga velocemente tra pagine. Window: 60s.
const lazyMatchLastRun = new Map<string, number>();
const LAZY_MATCH_WINDOW_MS = 60_000;

/**
 * Lazy auto-match: se esistono righe `software_inventory` senza una `patch_software_meta`
 * corrispondente (cioè scans arrivati DOPO l'ultimo runFullSyncMatch), esegue subito
 * un sync globale del tenant. Throttle 60s per tenant per evitare run frequenti.
 *
 * Async ma awaited: il chiamante può attendere il completamento prima di ritornare
 * la response. Su tenant medio ~50ms — accettabile.
 *
 * Ritorna `true` se ha effettivamente eseguito un sync, `false` se skipped.
 */
export function maybeRunLazyMatch(
  db: Database.Database,
  tenantCode: string
): boolean {
  // Throttle: skip se ultimo run < 60s fa
  const lastRun = lazyMatchLastRun.get(tenantCode) ?? 0;
  if (Date.now() - lastRun < LAZY_MATCH_WINDOW_MS) {
    return false;
  }
  // Check veloce: c'è almeno un software_inventory senza meta?
  // (LIMIT 1 → query ottimizzata, non scansiona tutto)
  const orphan = db
    .prepare(
      `SELECT 1 FROM software_inventory si
        WHERE NOT EXISTS (
          SELECT 1 FROM patch_software_meta psm WHERE psm.software_id = si.id
        )
        LIMIT 1`
    )
    .get();
  if (!orphan) {
    // Niente di nuovo da matchare, ma aggiorno timestamp per skippare il check ravvicinato
    lazyMatchLastRun.set(tenantCode, Date.now());
    return false;
  }
  // Aggiorno PRIMA del run (evita due trigger concorrenti durante un run lungo)
  lazyMatchLastRun.set(tenantCode, Date.now());
  try {
    runFullSyncMatch(db);
    return true;
  } catch (err) {
    console.error("[patch/matcher maybeRunLazyMatch] fail:", err);
    return false;
  }
}

/**
 * Sync globale matcher per il tenant corrente.
 *
 * Pass 1: per ogni `software_inventory` row di host Windows con scan ok, calcola
 *   `choco_id` via dictionary (lookupExact). Bulk UPSERT in `patch_software_meta`
 *   senza sovrascrivere righe `match_strategy='manual'`.
 *
 * Pass 2: SQL bulk INSERT in `patch_cve_target` matchando `wazuh_vuln.package_name`
 *   ↔ `software_inventory.name` (LIKE prefix) per quel host. Una sola query.
 *   Idempotente, preserva 'manual'.
 *
 * Pensata per essere triggerata manualmente da UI (bottone "Calcola matching").
 * Tempo: ~secondi su tenant medio (~3k software, ~30k wazuh_vuln).
 */
export function runFullSyncMatch(db: Database.Database): FullSyncResult {
  const start = Date.now();

  // --- Pass 1: dictionary lookup → patch_software_meta ---
  const allSoftware = db
    .prepare(
      `SELECT si.id, si.name
         FROM software_inventory si
         INNER JOIN software_scans ss ON ss.id = si.scan_id
         INNER JOIN hosts h ON h.id = ss.host_id
        WHERE ss.status = 'ok'
          AND ss.host_id IS NOT NULL
          AND LOWER(h.os_family) = 'windows'
       UNION
       SELECT si.id, si.name
         FROM software_inventory si
         INNER JOIN software_scans ss ON ss.id = si.scan_id
         INNER JOIN network_devices nd ON nd.id = ss.device_id
         INNER JOIN hosts h ON h.ip = nd.host
        WHERE ss.status = 'ok'
          AND ss.device_id IS NOT NULL
          AND LOWER(h.os_family) = 'windows'`
    )
    .all() as Array<{ id: number; name: string }>;

  const upsertMeta = db.prepare(`
    INSERT INTO patch_software_meta (software_id, choco_id, match_strategy, match_confidence, last_matched_at)
    VALUES (?, ?, 'dictionary', 0.8, datetime('now'))
    ON CONFLICT(software_id) DO UPDATE SET
      choco_id        = CASE WHEN patch_software_meta.match_strategy='manual'
                              THEN patch_software_meta.choco_id ELSE excluded.choco_id END,
      match_strategy  = CASE WHEN patch_software_meta.match_strategy='manual'
                              THEN patch_software_meta.match_strategy ELSE excluded.match_strategy END,
      match_confidence= CASE WHEN patch_software_meta.match_strategy='manual'
                              THEN patch_software_meta.match_confidence ELSE excluded.match_confidence END,
      last_matched_at = excluded.last_matched_at
  `);
  const txMeta = db.transaction((rows: Array<{ id: number; name: string }>) => {
    let n = 0;
    for (const r of rows) {
      const dict = lookupExact(r.name);
      if (dict) {
        upsertMeta.run(r.id, dict.choco);
        n++;
      }
    }
    return n;
  });
  const softwareWithChoco = txMeta(allSoftware);

  // --- Pass 2: bulk INSERT patch_cve_target da wazuh_vuln ---
  // Match LIKE bidirezionale prefix tra wv.package_name e si.name.
  // 2 branch UNION per coprire entrambe le strategie di link host↔scan:
  //   (a) software_scans.host_id = wazuh_agent.host_id (scan diretto)
  //   (b) software_scans.device_id → network_device.host = hosts.ip = wazuh_agent.host_id
  let cveTargetsWritten = 0;
  try {
    const result = db.prepare(`
      INSERT INTO patch_cve_target
        (cve_id, software_id, match_strategy, confidence, fix_package_manager, fix_package_id, fix_version, created_at)
      SELECT DISTINCT cve, software_id, 'wazuh-package', 0.9,
             CASE WHEN choco_id IS NOT NULL THEN 'choco' ELSE NULL END,
             choco_id, NULL, datetime('now')
      FROM (
        -- (a) scan diretto host_id
        SELECT wv.cve AS cve, si.id AS software_id, psm.choco_id AS choco_id
          FROM wazuh_vuln wv
          INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
          INNER JOIN software_scans ss ON ss.host_id = wa.host_id AND ss.status='ok'
          INNER JOIN software_inventory si ON si.scan_id = ss.id
          INNER JOIN hosts h ON h.id = wa.host_id
          LEFT JOIN patch_software_meta psm ON psm.software_id = si.id
         WHERE wv.package_name IS NOT NULL
           AND LOWER(h.os_family) = 'windows'
           AND (
             LOWER(si.name) LIKE LOWER(wv.package_name) || '%'
             OR LOWER(wv.package_name) LIKE LOWER(si.name) || '%'
           )
           AND (wv.package_version IS NULL OR si.version IS NULL OR wv.package_version = si.version)
        UNION ALL
        -- (b) scan via device_id mappato a host via IP
        SELECT wv.cve AS cve, si.id AS software_id, psm.choco_id AS choco_id
          FROM wazuh_vuln wv
          INNER JOIN wazuh_agent wa ON wa.agent_id = wv.agent_id
          INNER JOIN hosts h ON h.id = wa.host_id
          INNER JOIN network_devices nd ON nd.host = h.ip
          INNER JOIN software_scans ss ON ss.device_id = nd.id AND ss.status='ok'
          INNER JOIN software_inventory si ON si.scan_id = ss.id
          LEFT JOIN patch_software_meta psm ON psm.software_id = si.id
         WHERE wv.package_name IS NOT NULL
           AND LOWER(h.os_family) = 'windows'
           AND (
             LOWER(si.name) LIKE LOWER(wv.package_name) || '%'
             OR LOWER(wv.package_name) LIKE LOWER(si.name) || '%'
           )
           AND (wv.package_version IS NULL OR si.version IS NULL OR wv.package_version = si.version)
      )
      WHERE 1=1
      ON CONFLICT(cve_id, software_id) DO UPDATE SET
        match_strategy = CASE WHEN patch_cve_target.match_strategy='manual'
                                THEN patch_cve_target.match_strategy ELSE excluded.match_strategy END,
        confidence     = CASE WHEN patch_cve_target.match_strategy='manual'
                                THEN patch_cve_target.confidence ELSE excluded.confidence END,
        fix_package_manager = CASE WHEN patch_cve_target.match_strategy='manual'
                                THEN patch_cve_target.fix_package_manager ELSE excluded.fix_package_manager END,
        fix_package_id = CASE WHEN patch_cve_target.match_strategy='manual'
                                THEN patch_cve_target.fix_package_id ELSE excluded.fix_package_id END,
        created_at     = excluded.created_at
    `).run();
    cveTargetsWritten = result.changes ?? 0;
  } catch (err) {
    // Wazuh non presente / errore SQL: skip e ritorna parziale
    console.error("[patch/matcher runFullSyncMatch] pass 2 fail:", err);
  }

  return {
    softwareWithChoco,
    cveTargetsWritten,
    durationMs: Date.now() - start,
  };
}
