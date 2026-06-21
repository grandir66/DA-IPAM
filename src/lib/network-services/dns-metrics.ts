/** KPI e parsing stats AdGuard/Unbound per dashboard /dns */

export function pct(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function parseTopEntries(
  rows: Array<Record<string, number>> | undefined,
  limit = 5,
): Array<{ key: string; count: number }> {
  if (!rows?.length) return [];
  const flat: Array<{ key: string; count: number }> = [];
  for (const row of rows) {
    for (const [key, count] of Object.entries(row)) {
      if (typeof count === "number") flat.push({ key, count });
    }
  }
  return flat.sort((a, b) => b.count - a.count).slice(0, limit);
}

export function formatLatencySeconds(seconds: number | undefined): string {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "—";
  return `${(seconds * 1000).toFixed(1)} ms`;
}

export function resolverStat(
  resolver: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const v = resolver?.[key];
  return typeof v === "number" ? v : undefined;
}
