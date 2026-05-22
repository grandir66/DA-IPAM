/**
 * Diff fra due scan software_inventory.
 *
 * Matching: case-insensitive su `name`. Se più righe stesso nome (es. snap +
 * dpkg dello stesso pacchetto), si confrontano per `source+name` per evitare
 * falsi upgrade. La logica è quella più conservativa che mantiene utile il
 * diff anche con multi-source.
 */

import type { SoftwareInventoryRow } from "@/types";

export interface SoftwareUpgradeEntry {
  name: string;
  source: string;
  fromVersion: string | null;
  toVersion: string | null;
}

export interface SoftwareDiff {
  added: SoftwareInventoryRow[];
  removed: SoftwareInventoryRow[];
  upgraded: SoftwareUpgradeEntry[];
  unchangedCount: number;
}

function key(row: SoftwareInventoryRow): string {
  return `${row.source}|${row.name.toLowerCase()}`;
}

/**
 * Calcola added/removed/upgraded fra due snapshot.
 * @param before inventory dello scan "vecchio" (against)
 * @param after  inventory dello scan "nuovo" (scanId)
 */
export function computeSoftwareDiff(
  before: SoftwareInventoryRow[],
  after: SoftwareInventoryRow[]
): SoftwareDiff {
  const beforeMap = new Map<string, SoftwareInventoryRow>();
  for (const row of before) {
    const k = key(row);
    if (!beforeMap.has(k)) beforeMap.set(k, row);
  }
  const afterMap = new Map<string, SoftwareInventoryRow>();
  for (const row of after) {
    const k = key(row);
    if (!afterMap.has(k)) afterMap.set(k, row);
  }

  const added: SoftwareInventoryRow[] = [];
  const removed: SoftwareInventoryRow[] = [];
  const upgraded: SoftwareUpgradeEntry[] = [];
  let unchangedCount = 0;

  for (const [k, row] of afterMap) {
    const prev = beforeMap.get(k);
    if (!prev) {
      added.push(row);
      continue;
    }
    const pv = prev.version ?? "";
    const cv = row.version ?? "";
    if (pv !== cv) {
      upgraded.push({
        name: row.name,
        source: row.source,
        fromVersion: prev.version,
        toVersion: row.version,
      });
    } else {
      unchangedCount += 1;
    }
  }

  for (const [k, row] of beforeMap) {
    if (!afterMap.has(k)) removed.push(row);
  }

  return { added, removed, upgraded, unchangedCount };
}
