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

/** Estrae il corpo di una funzione da `startIdx` bilanciando le graffe (dal primo `{`). */
function extractBody(src: string, startIdx: number): string {
  const open = src.indexOf("{", startIdx);
  if (open < 0) return src.slice(startIdx, startIdx + 200);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(startIdx, j + 1);
    }
  }
  return src.slice(startIdx);
}

/**
 * Estrae `export function <name>(...)` col VERO corpo (graffe bilanciate) — così non
 * iningloba le funzioni non-esportate interposte (che falsavano il confronto).
 */
function parseFns(file: string): Map<string, string> {
  const src = readFileSync(join(ROOT, file), "utf8");
  const re = /export function (\w+)\s*[<(]/g;
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.set(m[1], extractBody(src, m.index));
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

// Modalità diff: `npx tsx scripts/audit-db-drift.ts --diff <nomeFunzione>`
// stampa le righe (normalizzate) presenti in una copia e non nell'altra.
const diffArg = process.argv.indexOf("--diff");
if (diffArg >= 0 && process.argv[diffArg + 1]) {
  const name = process.argv[diffArg + 1];
  const a = dbFns.get(name);
  const b = tenantFns.get(name);
  if (!a || !b) {
    console.log(`${name}: presente in db.ts=${!!a} db-tenant.ts=${!!b}`);
    process.exit(0);
  }
  const linesA = normalize(a).split(/(?<=;|\{|\})\s*/).map((s) => s.trim()).filter(Boolean);
  const linesB = normalize(b).split(/(?<=;|\{|\})\s*/).map((s) => s.trim()).filter(Boolean);
  const setB = new Set(linesB);
  const setA = new Set(linesA);
  console.log(`\n### ${name} — solo in db.ts (facade):`);
  linesA.filter((l) => !setB.has(l)).forEach((l) => console.log("  db>  " + l.slice(0, 160)));
  console.log(`\n### ${name} — solo in db-tenant.ts (sorgente):`);
  linesB.filter((l) => !setA.has(l)).forEach((l) => console.log("  tn>  " + l.slice(0, 160)));
  process.exit(0);
}

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
