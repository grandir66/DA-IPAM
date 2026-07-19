/**
 * audit-api-auth.ts — WAVE 0 / W0-1
 *
 * Inventario statico delle guardie auth su ogni route API di DA-IPAM.
 * Per ogni `src/app/api/**\/route.ts` e per ogni metodo HTTP esportato determina:
 *  - guardia ATTUALE (superadmin | admin | auth | session-only | none)
 *  - guardia TARGET  (GET sensibile → auth ; mutazioni → admin ; eccezioni → public)
 *  - FLAG se l'attuale è più debole del target
 *
 * Nota: analisi euristica testuale (non AST). Se un metodo delega la guardia a un
 * helper interno non la rileva → i FLAG vanno confermati a mano. È un punto di
 * partenza per Wave 1, non un verdetto.
 *
 * Uso:  npx tsx scripts/audit-api-auth.ts
 * Out:  docs/auth-matrix.md  + riepilogo su stdout
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src/app/api");
const OUT = join(ROOT, "docs/auth-matrix.md");

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Level = "superadmin" | "admin" | "auth" | "session-only" | "none";
// Forza relativa. NB: `withTenantFromSession` ritorna 401 senza sessione → impone
// l'AUTENTICAZIONE (non il ruolo). Quindi per una lettura `session-only` protegge
// quanto `auth`: entrambi rank 1. Solo il RUOLO (admin/superadmin) sale di rank.
const RANK: Record<Level | "public", number> = {
  public: 0,
  none: 0,
  "session-only": 1,
  auth: 1,
  admin: 2,
  superadmin: 3,
};
// Route che, pur essendo letture, toccano credenziali/segreti o lanciano azioni con
// side-effect → andrebbero elevate ad admin (e i trigger convertiti a POST). Non un
// FLAG automatico ma una lista "da rivedere" per Wave 1.
const SENSITIVE_READ = /(test-|\/credentials|secret|password|decrypt|for_edit|\/export)/i;

interface Row {
  route: string;
  method: string;
  actual: Level;
  target: Level | "public";
  flag: boolean;
  review: boolean;
  note: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** Da un path file → route URL "/api/...". */
function routeUrl(file: string): string {
  let r = "/" + relative(join(ROOT, "src/app"), file).replace(/\/route\.ts$/, "");
  r = r.replace(/\\/g, "/");
  return r === "/api" ? "/api" : r;
}

/** Le route pubbliche ammesse (nessuna guardia richiesta). */
function isPublic(route: string): boolean {
  return (
    route.startsWith("/api/auth") ||
    route === "/api/setup" ||
    route.startsWith("/api/health") ||
    route === "/api/version"
  );
}

/** Trova gli offset di dichiarazione di ogni metodo HTTP esportato. */
function findMethodSpans(src: string): { method: string; start: number }[] {
  const spans: { method: string; start: number }[] = [];
  const reFn = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const reConst = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = reFn.exec(src))) spans.push({ method: m[1], start: m.index });
  while ((m = reConst.exec(src))) spans.push({ method: m[1], start: m.index });
  return spans.sort((a, b) => a.start - b.start);
}

/** Classifica la guardia più forte presente in uno slice di codice. */
function classify(slice: string): Level {
  if (/\brequireSuperAdmin\s*\(/.test(slice)) return "superadmin";
  if (/\brequireAdmin(?:OrOnboarding)?\s*\(/.test(slice)) return "admin";
  if (/\brequireAuth\s*\(/.test(slice)) return "auth";
  if (/\bwithTenantFromSession\s*\(/.test(slice)) return "session-only";
  return "none";
}

const files = walk(API_DIR);
const rows: Row[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const route = routeUrl(file);
  const pub = isPublic(route);
  const spans = findMethodSpans(src);
  if (spans.length === 0) continue;

  for (let i = 0; i < spans.length; i++) {
    const { method, start } = spans[i];
    const end = i + 1 < spans.length ? spans[i + 1].start : src.length;
    const slice = src.slice(start, end);
    const actual = classify(slice);

    let target: Level | "public";
    if (pub) target = "public";
    else if (MUTATING.has(method)) target = "admin";
    else target = "auth"; // GET/HEAD/OPTIONS sensibili

    const flag = !pub && RANK[actual] < RANK[target];
    // "review": lettura autenticata ma su risorsa sensibile → probabile elevazione ad admin
    const review =
      !pub && !flag && !MUTATING.has(method) &&
      (actual === "session-only" || actual === "auth") &&
      SENSITIVE_READ.test(route);
    let note = "";
    if (pub) note = "eccezione pubblica";
    else if (actual === "none") note = "NESSUNA guardia rilevata (verifica: helper interno?)";
    else if (flag && MUTATING.has(method)) note = "mutazione eseguibile da viewer → requireAdmin";
    else if (review) note = "lettura sensibile (credenziali/segreti/trigger) → valutare admin + POST";

    rows.push({ route, method, actual, target, flag, review, note });
  }
}

// ordina: flaggate prima, poi per route
rows.sort((a, b) => {
  if (a.flag !== b.flag) return a.flag ? -1 : 1;
  if (a.route !== b.route) return a.route.localeCompare(b.route);
  return a.method.localeCompare(b.method);
});

const flagged = rows.filter((r) => r.flag);
const review = rows.filter((r) => r.review);
const byActual = (lv: Level) => rows.filter((r) => r.actual === lv).length;

// --- render markdown ---
const stamp = process.env.AUDIT_STAMP || "(esegui con AUDIT_STAMP=YYYY-MM-DD per datare)";
const lines: string[] = [];
lines.push("# Matrice auth API — DA-IPAM");
lines.push("");
lines.push(`> Generato da \`scripts/audit-api-auth.ts\` · ${stamp} · analisi euristica, i FLAG vanno confermati.`);
lines.push("");
lines.push("## Riepilogo");
lines.push("");
lines.push(`- Route file analizzati: **${files.length}**`);
lines.push(`- Endpoint (metodo×route): **${rows.length}**`);
lines.push("");
lines.push("Modello: `withTenantFromSession` impone l'autenticazione (401 senza sessione) ma **non il ruolo**. Quindi una *lettura* `session-only` è protetta quanto `auth`. Il rischio è: **mutazioni** senza ruolo admin, e **letture sensibili** (credenziali/segreti/trigger) che dovrebbero essere admin.");
lines.push("");
lines.push(`- 🔴 **FLAG (mutazione senza requireAdmin, o nessuna guardia): ${flagged.length}**`);
lines.push(`  - mutazioni (POST/PUT/PATCH/DELETE) eseguibili da viewer: **${flagged.filter((r) => MUTATING.has(r.method)).length}**`);
lines.push(`  - endpoint \`none\` (nessuna guardia rilevata, non pubblici): **${flagged.filter((r) => r.actual === "none").length}**`);
lines.push(`- 🟡 **REVIEW (letture sensibili da valutare admin + POST): ${review.length}**`);
lines.push("");
lines.push("Distribuzione guardia attuale: " +
  (["superadmin", "admin", "auth", "session-only", "none"] as Level[])
    .map((lv) => `\`${lv}\`=${byActual(lv)}`).join(" · "));
lines.push("");
lines.push("## 🔴 FLAG — da correggere (Wave 1)");
lines.push("");
lines.push("| Route | Metodo | Attuale | Target | Nota |");
lines.push("|---|---|---|---|---|");
for (const r of flagged) {
  lines.push(`| \`${r.route}\` | ${r.method} | \`${r.actual}\` | \`${r.target}\` | ${r.note} |`);
}
if (flagged.length === 0) lines.push("| — | — | — | — | nessun flag |");
lines.push("");
lines.push("## 🟡 REVIEW — letture sensibili da valutare (Wave 1)");
lines.push("");
lines.push("| Route | Metodo | Attuale | Nota |");
lines.push("|---|---|---|---|");
for (const r of review) {
  lines.push(`| \`${r.route}\` | ${r.method} | \`${r.actual}\` | ${r.note} |`);
}
if (review.length === 0) lines.push("| — | — | — | nessuna |");
lines.push("");
lines.push("## Inventario completo");
lines.push("");
lines.push("| Route | Metodo | Attuale | Target | Flag |");
lines.push("|---|---|---|---|---|");
for (const r of rows) {
  const mark = r.flag ? "🔴" : r.review ? "🟡" : "";
  lines.push(`| \`${r.route}\` | ${r.method} | \`${r.actual}\` | \`${r.target}\` | ${mark} |`);
}
lines.push("");

mkdirSync(join(ROOT, "docs"), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

// --- stdout summary ---
console.log(`route file: ${files.length} · endpoint: ${rows.length}`);
console.log(`🔴 FLAG (mutazioni viewer + none): ${flagged.length}`);
console.log(`   - mutazioni eseguibili da viewer: ${flagged.filter((r) => MUTATING.has(r.method)).length}`);
console.log(`   - none (no guardia, non pubblici): ${flagged.filter((r) => r.actual === "none").length}`);
console.log(`🟡 REVIEW (letture sensibili): ${review.length}`);
console.log(`→ scritto ${relative(ROOT, OUT)}`);
