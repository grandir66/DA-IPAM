/**
 * I grafici e le classifiche della pagina «Alert sicurezza» dagli eventi dei DC, nella stessa forma
 * che dà l'indexer di Wazuh (`AlertStats`): la pagina non sa da dove arrivano.
 *
 * Le nostre sonde stanno nella categoria `self_probe` già in archivio: si contano nel grafico come
 * diagnostica e restano fuori dalle classifiche, come con Wazuh.
 */

import type { Database } from "better-sqlite3";
import { ALERT_CATEGORIES, accountKind } from "@/lib/integrations/wazuh-alerts";
import type { AlertStats, CategorySlice, RankedEntry, SeriesRow, TargetedAccount } from "@/lib/integrations/wazuh-alerts-stats";

const TOP = 100;

/** «5m», «1h», «6h», «1d» in millisecondi. */
export function msIntervallo(interval: string): number {
  const m = interval.match(/^(\d+)([mhd])$/);
  if (!m) return 3_600_000;
  const n = Number(m[1]);
  return n * (m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000);
}

/** Inizi dei bucket da `since` a `ora`, allineati all'epoca come il date_histogram dell'indexer. */
export function bucketDa(since: string, interval: string, ora: Date = new Date()): number[] {
  const passo = msIntervallo(interval);
  const out: number[] = [];
  for (let t = Math.floor(Date.parse(since) / passo) * passo; t <= ora.getTime(); t += passo) out.push(t);
  return out;
}

interface Riga {
  quando: string;
  event_id: number;
  categoria: string;
  dc: string;
  account: string | null;
  ip: string | null;
  postazione: string | null;
}

/** Il filtro «sistema»: i DC sono solo Windows, ogni altro sistema dà una pagina vuota. */
export function statisticheDc(db: Database, args: { since: string; interval: string; system?: string; ora?: Date }): AlertStats {
  const righe =
    args.system && args.system !== "windows"
      ? []
      : (db
          // Login e logout riusciti non sono allarmi: fuori dai grafici della pagina degli allarmi.
          .prepare("SELECT quando, event_id, categoria, dc, account, ip, postazione FROM dc_evento WHERE quando >= ? AND categoria NOT IN ('accesso', 'uscita') ORDER BY quando")
          .all(args.since) as Riga[]);

  const passo = msIntervallo(args.interval);
  const inizi = bucketDa(args.since, args.interval, args.ora);
  const serie = new Map<number, SeriesRow>(inizi.map((t) => [t, { bucket: new Date(t).toISOString() } as SeriesRow]));
  const perCategoria = new Map<string, number>();
  for (const r of righe) {
    perCategoria.set(r.categoria, (perCategoria.get(r.categoria) ?? 0) + 1);
    const t = Math.floor(Date.parse(r.quando) / passo) * passo;
    const riga = serie.get(t);
    if (riga) riga[r.categoria] = (Number(riga[r.categoria]) || 0) + 1;
  }
  const categorie = [...perCategoria.keys()];
  // Ogni riga ha tutte le categorie presenti, a 0 dove manca: come il min_doc_count 0 dell'indexer.
  for (const riga of serie.values()) for (const c of categorie) if (riga[c] === undefined) riga[c] = 0;

  const byCategory: CategorySlice[] = categorie
    .map((id) => {
      const meta = ALERT_CATEGORIES.find((c) => c.id === id);
      return { id, labelIt: meta?.labelIt ?? id, count: perCategoria.get(id) ?? 0, diagnostic: meta?.diagnostic === true };
    })
    .sort((a, b) => b.count - a.count);

  // Le classifiche: i nostri tentativi (self_probe) fuori, come i filtri selfExclusions dell'indexer.
  const ostili = righe.filter((r) => r.categoria !== "self_probe");
  const falliti = ostili.filter((r) => r.categoria === "auth_failure" && r.event_id !== 4740);

  const topAccounts: TargetedAccount[] = classifica(falliti, (r) => r.account).map((g) => ({
    account: g.chiave,
    count: g.n,
    sourceIp: piuFrequente(g.righe, (r) => r.ip),
    workstation: piuFrequente(g.righe, (r) => r.postazione),
    detectedBy: piuFrequente(g.righe, (r) => r.dc),
    lastSeenAt: g.ultimo,
    system: "windows",
    kind: accountKind(g.chiave),
  }));

  const byTarget: RankedEntry[] = classifica(ostili, (r) => r.dc).map((g) => ({
    key: g.chiave,
    count: g.n,
    detail: piuFrequente(g.righe, (r) => r.account),
    lastSeenAt: g.ultimo,
  }));

  // Da dove parte: IP e postazioni nella stessa classifica, come con Wazuh.
  const bySource: RankedEntry[] = [
    ...classifica(ostili, (r) => r.ip),
    ...classifica(ostili, (r) => r.postazione),
  ]
    .map((g) => ({ key: g.chiave, count: g.n, detail: piuFrequente(g.righe, (r) => r.account), lastSeenAt: g.ultimo }))
    .sort((a, b) => b.count - a.count);

  return {
    totals: {
      alerts: righe.length,
      agents: new Set(righe.map((r) => r.dc)).size,
      rules: new Set(righe.map((r) => r.event_id)).size,
    },
    byCategory,
    series: [...serie.values()],
    topAccounts,
    byTarget,
    bySource,
  };
}

interface Gruppo {
  chiave: string;
  n: number;
  ultimo: string | null;
  righe: Riga[];
}

function classifica(righe: readonly Riga[], chiave: (r: Riga) => string | null): Gruppo[] {
  const m = new Map<string, Gruppo>();
  for (const r of righe) {
    const k = chiave(r);
    if (!k) continue;
    const g = m.get(k) ?? { chiave: k, n: 0, ultimo: null, righe: [] };
    g.n++;
    g.righe.push(r);
    if (!g.ultimo || r.quando > g.ultimo) g.ultimo = r.quando;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, TOP);
}

function piuFrequente(righe: readonly Riga[], campo: (r: Riga) => string | null): string | null {
  const conta = new Map<string, number>();
  for (const r of righe) {
    const v = campo(r);
    if (v) conta.set(v, (conta.get(v) ?? 0) + 1);
  }
  let migliore: string | null = null;
  let max = 0;
  for (const [v, n] of conta) if (n > max) [migliore, max] = [v, n];
  return migliore;
}
