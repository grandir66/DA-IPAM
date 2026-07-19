/**
 * audit-db-drift.ts — mappa il drift tra le funzioni omonime di `db.ts` (facade) e
 * `db-tenant.ts` (sorgente). Le due copie dovrebbero essere equivalenti; quelle che
 * DIFFERISCONO nel corpo sono candidate a bug latenti (come createNetwork, fix v0.3.155).
 *
 * Normalizza le differenze attese (`getDb()` vs `db()`, commenti, whitespace) e
 * confronta il resto. Output: elenco delle funzioni DRIFTATE + quelle solo-in-uno.
 *
 * Uso:  npx tsx scripts/audit-db-drift.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

interface Fn { name: string; body: string; }

/** Estrae tutte le `export function <name>(...)` con il loro corpo (fino alla prossima). */
function parseFns(file: string): Map<string, string> {
  const src = readFileSync(join(ROOT, file), "utf8");
  const re = /export function (\w+)\s*[<(]/g;
  const starts: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], idx: m.index });
  const out = new Map<string, string>();
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].idx : src.length;
    out.set(starts[i].name, src.slice(starts[i].idx, end));
  }
  return out;
}

/** Normalizza per confronto: rimuove commenti, uniforma getDb()/db(), collassa spazi. */
function normalize(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/\/\/[^\n]*/g, "")          // line comments
    .replace(/\bgetDb\(\)/g, "db()")     // differenza attesa facade↔sorgente
    .replace(/\s+/g, " ")
    .trim();
}

const dbFns = parseFns("src/lib/db.ts");
const tenantFns = parseFns("src/lib/db-tenant.ts");

const common: string[] = [];
for (const name of dbFns.keys()) if (tenantFns.has(name)) common.push(name);

const drifted: { name: string; dbLen: number; tenantLen: number }[] = [];
for (const name of common) {
  const a = normalize(dbFns.get(name)!);
  const b = normalize(tenantFns.get(name)!);
  if (a !== b) {
    drifted.push({ name, dbLen: dbFns.get(name)!.split("\n").length, tenantLen: tenantFns.get(name)!.split("\n").length });
  }
}
drifted.sort((x, y) => Math.abs(y.dbLen - y.tenantLen) - Math.abs(x.dbLen - x.tenantLen));

const lines: string[] = [];
lines.push("# Drift `db.ts` ↔ `db-tenant.ts`");
lines.push("");
lines.push(`> Generato da \`scripts/audit-db-drift.ts\` · funzioni omonime: **${common.length}** · DRIFTATE: **${drifted.length}**`);
lines.push("> Le driftate hanno corpo diverso (oltre a getDb/db, commenti, spazi) → candidate a bug latenti.");
lines.push("");
lines.push("## Funzioni DRIFTATE (da riconciliare / verificare)");
lines.push("");
lines.push("| Funzione | righe db.ts | righe db-tenant.ts | Δ righe |");
lines.push("|---|---|---|---|");
for (const d of drifted) {
  lines.push(`| \`${d.name}\` | ${d.dbLen} | ${d.tenantLen} | ${Math.abs(d.dbLen - d.tenantLen)} |`);
}
if (drifted.length === 0) lines.push("| — | — | — | nessuna |");
lines.push("");

mkdirSync(join(ROOT, "docs"), { recursive: true });
writeFileSync(join(ROOT, "docs/db-drift.md"), lines.join("\n"), "utf8");

console.log(`funzioni omonime: ${common.length} · DRIFTATE: ${drifted.length}`);
console.log("drift più grossi:", drifted.slice(0, 12).map((d) => `${d.name}(Δ${Math.abs(d.dbLen - d.tenantLen)})`).join(", "));
console.log("→ docs/db-drift.md");
