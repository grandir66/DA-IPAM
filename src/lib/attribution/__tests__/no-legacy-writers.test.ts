// Test di guardia (fase 4, ritiro legacy — Task 2): dopo aver rimosso i writer
// legacy (auto-classify, bypass in cron/jobs.ts, enrich-host.ts, ad-client.ts,
// batch-refingerprint.ts), `applyAttribution` (src/lib/attribution/persist.ts)
// deve restare l'UNICO scrittore automatico delle colonne hosts.classification/
// inferred_*. Questo test scansiona i sorgenti sotto src/ e fallisce se un file
// FUORI da un'allowlist esplicita contiene un'istruzione che scrive quelle
// colonne — così un futuro bypass reintrodotto viene bloccato qui, non scoperto
// in produzione.
//
// Perché non un semplice grep su "UPDATE hosts SET": questo codebase usa DUE
// idiomi per scrivere hosts.* con better-sqlite3:
//   (a) template letterale completo:   `UPDATE hosts SET classification = ?, ... WHERE id = ?`
//   (b) SET clause costruita a runtime: fields.push("classification = ?"); poi
//       `UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`
// Il caso (b) richiede di intercettare il frammento letterale "classification = ?"
// ovunque appaia come stringa a sé stante (non dentro un'altra istruzione SQL),
// non solo dentro un template che inizia per "UPDATE hosts SET".
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Colonne "legacy" sotto sorveglianza: la classificazione slug + tutti gli
 * `inferred_*` (device_type, vendor, os_family, confidence, protocol,
 * scan_target, reasons, at, classifier_version). NON includiamo `attr_*`
 * (quelle sono l'engine v2 stesso, il suo scrittore è ovviamente legittimo)
 * né `classification_json`/`classification_reason` da soli quando non
 * accompagnati da `classification`/`inferred_` (il motore legacy separato in
 * src/lib/classification/ li scrive insieme a `classification`, quindi
 * ricadono comunque nel match).
 */
const COLUMN_RE = "(classification(?:_manual)?|inferred_[a-zA-Z_]+)";

/**
 * Allowlist esplicita: SOLO questi file possono contenere una scrittura diretta
 * di hosts.classification/inferred_*. Ogni voce ha il motivo per cui è legittima.
 * Se il test fallisce nominando un file non in questa lista, qualcuno ha
 * reintrodotto un bypass: NON aggiungere il file qui senza aver prima verificato
 * (come per questo task) che l'evidenza equivalente sia emessa altrove e che
 * recomputeAttributionSafe venga comunque chiamato.
 */
const ALLOWED_FILES: Record<string, string> = {
  "src/lib/attribution/persist.ts":
    "L'UNICO scrittore automatico (fase 4): applyAttribution scrive attr_* e, " +
    "come proiezione (legacy-projection.ts), classification/inferred_* — solo se " +
    "classification_manual=0 e il valore proiettato è non-null e diverso dal " +
    "corrente. Tutti gli altri writer di questo file sono stati ritirati nel Task 2.",

  "src/lib/db-tenant.ts":
    "Tre scritture dirette, tutte legittime e NON automatiche/di scan, distinte " +
    "dal motore v2: " +
    "(1) upsertHost — pass-through generico: se il CHIAMANTE fornisce esplicitamente " +
    "input.classification (es. mdm-sync.ts per device MDM riconosciuti come " +
    "smartphone, o creazione manuale via /api/hosts), lo scrive rispettando " +
    "classification_manual — non è una rideterminazione automatica, è un valore " +
    "che il chiamante dichiara di conoscere già con certezza. " +
    "(2) updateHost — correzione manuale dell'utente (scheda host): imposta anche " +
    "classification_manual=1, è la funzione che rende un host immune a future " +
    "proiezioni automatiche (invariante sacro del piano). " +
    "(3) cleanupStaleHosts — scrive il sentinel 'stale' in classification per host " +
    "offline da tempo: non è una classificazione di tipo device, è un marcatore di " +
    "ciclo di vita per la pipeline di pulizia/cancellazione, semanticamente estraneo " +
    "all'attribuzione.",

  "src/lib/db.ts":
    "Facade di db-tenant.ts (fallback DEFAULT tenant): stesse tre scritture " +
    "legittime e per lo stesso motivo — vedi src/lib/db-tenant.ts.",

  "src/lib/classification/persist.ts":
    "Motore di classificazione SEPARATO e preesistente (applyClassificationDecision), " +
    "non uno dei 'quattro bypass' ritirati in questo task (auto-classify, " +
    "cron/jobs.ts, enrich-host.ts, ad-client.ts, batch-refingerprint.ts — vedi intro " +
    "del piano fase 4). Restа dietro un'azione ESPLICITA dell'utente in UI " +
    "(classifySubnet() → /api/networks/[id]/refresh e /apply-classifications), " +
    "non viene invocato automaticamente da scan/cron. Fuori scope Task 2: la sua " +
    "eventuale dismissione è un lavoro separato (Task 3 rimuove solo la chiamata " +
    "UI transitoria post-attribuzione, non l'intero motore).",
};

interface Hit {
  file: string;
  line: number;
  kind: "UPDATE-literal" | "fragment";
  text: string;
}

/** Rimuove commenti a blocco e a riga preservando newline/offset (per numerare le righe). */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split("\n")
    .map((line) => {
      // (?<!:) evita di troncare gli URL "http://...": tagliamo solo un "//" NON
      // preceduto da ":" sulla stessa riga.
      const idx = line.search(/(?<!:)\/\//);
      if (idx === -1) return line;
      return line.slice(0, idx) + " ".repeat(line.length - idx);
    })
    .join("\n");
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
}

/**
 * Scansiona una sorgente TS/TSX già "pulita" dai commenti e ritorna le scritture
 * dirette di colonne legacy trovate, secondo i due idiomi (a)/(b) descritti sopra.
 * Esportata dalla logica del test stesso (non da un modulo di produzione): è
 * un'utility SOLO di test, tenerla qui evita di esporre un tool di lint ad-hoc.
 */
function scanForLegacyWrites(raw: string): Array<{ line: number; kind: Hit["kind"]; text: string }> {
  const src = stripComments(raw);
  // Letterali stringa/template: `...`, "...", '...'. Approssimazione via regex
  // (non un parser JS completo) — sufficiente perché le query SQL in questo
  // codebase sono sempre letterali semplici, senza backtick annidati nelle
  // interpolazioni ${...}.
  // NB: target tsconfig è ES2017, il flag 's' (dotAll) richiede ES2018+ (TS1501).
  // [\s\S] al posto di "." ottiene lo stesso effetto (match anche su newline)
  // senza bisogno del flag.
  const LITERAL_RE = /`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'/g;
  const COL_ASSIGN_ANY_RE = new RegExp(`\\b${COLUMN_RE}\\s*=\\s*(?:\\?|'[^']*'|"[^"]*"|\\d+)`);
  const SELF_CONTAINED_FRAGMENT_RE = new RegExp(`^${COLUMN_RE}\\s*=\\s*(?:\\?|'[^']*'|"[^"]*"|\\d+)$`);
  // Caso (c): tupla `[column, value]` il cui `column` viene poi interpolato in un
  // template `${column} = ?` a runtime (idioma usato da persist.ts stesso: array
  // `candidates`/`toWrite` con SET clause assemblata via `.map(([c]) => \`${c} = ?\`)`).
  // Qui il nome colonna appare come stringa letterale isolata (non affiancata da
  // "= ?"), quindi (a)/(b) non lo vedono: serve un terzo pattern dedicato.
  const TUPLE_COLUMN_RE = new RegExp(`\\[\\s*['"\`]${COLUMN_RE}['"\`]\\s*,`, "g");
  // Caso (b)/(c) sono ambigui sulla tabella di destinazione (il frammento è
  // isolato): li consideriamo solo nei file che toccano DAVVERO la tabella hosts
  // da qualche parte — altrimenti un file come db-hub.ts (tabelle hub, es.
  // fingerprint_classification_map, che ha anch'essa una colonna "classification")
  // genererebbe un falso positivo.
  const touchesHostsTable = /\b(FROM|UPDATE|INTO)\s+hosts\b/i.test(src);

  const hits: Array<{ line: number; kind: Hit["kind"]; text: string }> = [];
  for (const m of src.matchAll(LITERAL_RE)) {
    const inner = m[0].slice(1, -1);
    const trimmed = inner.trim();
    const line = raw.slice(0, m.index).split("\n").length;

    const updateMatch = /^\s*UPDATE\s+hosts\s+SET\b/i.exec(inner);
    if (updateMatch) {
      const afterSet = inner.slice(updateMatch[0].length);
      const whereIdx = afterSet.search(/\bWHERE\b/i);
      const setClause = whereIdx === -1 ? afterSet : afterSet.slice(0, whereIdx);
      if (COL_ASSIGN_ANY_RE.test(setClause)) {
        hits.push({ line, kind: "UPDATE-literal", text: setClause.replace(/\s+/g, " ").trim().slice(0, 200) });
      }
      continue;
    }

    if (touchesHostsTable && SELF_CONTAINED_FRAGMENT_RE.test(trimmed)) {
      hits.push({ line, kind: "fragment", text: trimmed });
    }
  }

  if (touchesHostsTable) {
    for (const m of src.matchAll(TUPLE_COLUMN_RE)) {
      const line = raw.slice(0, m.index).split("\n").length;
      hits.push({ line, kind: "fragment", text: m[0].trim() });
    }
  }

  return hits;
}

function scanRepo(): Record<string, Array<{ line: number; kind: Hit["kind"]; text: string }>> {
  const files: string[] = [];
  walk(path.join(SRC_ROOT), files);

  const byFile: Record<string, Array<{ line: number; kind: Hit["kind"]; text: string }>> = {};
  for (const abs of files) {
    const raw = fs.readFileSync(abs, "utf8");
    const hits = scanForLegacyWrites(raw);
    if (hits.length > 0) {
      const rel = path.relative(path.resolve(SRC_ROOT, ".."), abs).split(path.sep).join("/");
      byFile[rel] = hits;
    }
  }
  return byFile;
}

describe("no-legacy-writers (fase 4, guard test)", () => {
  it("scanForLegacyWrites rileva un UPDATE hosts SET letterale con classification/inferred_*", () => {
    const hits = scanForLegacyWrites(
      "function x() {\n  db.prepare(`UPDATE hosts SET classification = ?, updated_at = datetime('now') WHERE id = ?`).run(a, b);\n}\n"
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, "UPDATE-literal");
    assert.match(hits[0].text, /classification\s*=\s*\?/);
  });

  it("scanForLegacyWrites rileva il frammento dinamico fields.push(\"inferred_os_family = ?\") in un file che tocca hosts", () => {
    const hits = scanForLegacyWrites(
      'function upsertHost() {\n  db.prepare("SELECT 1 FROM hosts WHERE id = ?");\n  fields.push("inferred_os_family = ?");\n  db.prepare(`UPDATE hosts SET ${fields.join(", ")} WHERE id = ?`);\n}\n'
    );
    const fragment = hits.find((h) => h.kind === "fragment");
    assert.ok(fragment, "il frammento dinamico deve essere rilevato");
    assert.match(fragment!.text, /inferred_os_family\s*=\s*\?/);
  });

  it("scanForLegacyWrites rileva la tupla [\"classification\", valore] in un file che tocca hosts (idioma persist.ts)", () => {
    const hits = scanForLegacyWrites(
      'function applyAttribution() {\n' +
      '  db.prepare("SELECT classification FROM hosts WHERE id = ?");\n' +
      '  const candidates = [\n' +
      '    ["classification", projection.classification, current.classification],\n' +
      '  ];\n' +
      '}\n'
    );
    const fragment = hits.find((h) => h.text.includes("classification"));
    assert.ok(fragment, "la tupla con colonna letterale deve essere rilevata");
  });

  it("scanForLegacyWrites IGNORA confronti in WHERE (falso positivo noto: SELECT ... WHERE classification = ?)", () => {
    const hits = scanForLegacyWrites(
      'db.prepare("SELECT * FROM hosts WHERE classification = ?").get(id);\n'
    );
    assert.equal(hits.length, 0);
  });

  it("scanForLegacyWrites IGNORA un frammento isolato in un file che non tocca la tabella hosts", () => {
    const hits = scanForLegacyWrites(
      'db.prepare("SELECT 1 FROM fingerprint_classification_map");\n' +
      'sets.push("classification = ?");\n'
    );
    assert.equal(hits.length, 0);
  });

  it("nessun file fuori dall'allowlist scrive hosts.classification/inferred_* (fase 4: un solo scrittore)", () => {
    const byFile = scanRepo();
    const unexpected = Object.keys(byFile).filter((f) => !(f in ALLOWED_FILES));

    if (unexpected.length > 0) {
      const details = unexpected
        .map((f) => {
          const lines = byFile[f].map((h) => `    L${h.line} [${h.kind}] ${h.text}`).join("\n");
          return `  ${f}:\n${lines}`;
        })
        .join("\n");
      assert.fail(
        `Trovata una scrittura diretta di hosts.classification/inferred_* fuori ` +
        `dall'allowlist (fase 4 richiede un solo scrittore: src/lib/attribution/persist.ts, ` +
        `che proietta il risultato della fusione). File non attesi:\n${details}\n\n` +
        `Se è un nuovo bypass reintrodotto per errore: rimuovilo e assicurati che il ` +
        `percorso emetta comunque evidenza (src/lib/attribution/emitters.ts) e chiami ` +
        `recomputeAttributionSafe. Se è invece un caso legittimo nuovo, aggiungilo a ` +
        `ALLOWED_FILES in questo test con un commento che ne spiega il motivo.`
      );
    }

    // Verifica converso: l'allowlist non deve contenere voci "morte" (file che
    // non scrivono più nulla) — altrimenti un futuro ritiro di uno dei writer
    // legittimi passerebbe inosservato e l'allowlist diventerebbe documentazione
    // stale invece che specifica verificata.
    for (const f of Object.keys(ALLOWED_FILES)) {
      assert.ok(
        f in byFile,
        `${f} è in ALLOWED_FILES ma non contiene più alcuna scrittura rilevata — ` +
        `rimuovi la voce (o la logica di scan) se il writer è stato davvero ritirato.`
      );
    }
  });
});
