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
