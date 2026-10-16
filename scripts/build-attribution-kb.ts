/**
 * Build della KB vendorizzata per l'attribuzione dispositivi (Attribution v2, Fase 2).
 *
 * Scarica (o legge offline) due dataset GPL-2 di terze parti e li normalizza in un
 * artefatto SQLite committato (`data/attribution-kb.sqlite`), letto SOLO in lettura
 * a runtime dall'appliance — che non scarica mai nulla da internet.
 *
 * Fonti (vedi anche `data/NOTICE-attribution-kb.md`):
 * - Wireshark `manuf` — https://www.wireshark.org/download/automated/data/manuf — GPL-2
 *   TSV: `prefisso<TAB>nome_breve<TAB>nome_completo`. Prefissi MA-L (24 bit, es. "00:00:01"),
 *   MA-M (/28, es. "00:55:DA:00/28") e MA-S (/36, es. "00:1B:C5:00:00/36"). Righe `#` = commenti.
 * - GLPI `sysobject.ids` — https://raw.githubusercontent.com/glpi-project/sysobject.ids/master/sysobject.ids — GPL-2
 *   TSV: `id<TAB>vendor<TAB>TYPE<TAB>modello<TAB>modulo`. `id` è di norma RELATIVO all'arco
 *   enterprise (`14988` → `1.3.6.1.4.1.14988`), ma alcune righe sono OID ASSOLUTI
 *   (es. `1.2.826.0.1.4616240.1.1.4500`, arco iso.member-body).
 *
 * REGOLA di normalizzazione sysObjectID (vedi `normalizeSysObjId`), applicata in quest'ordine:
 *   1. se l'id inizia per "1.3.6.1" (o è esattamente "1.3.6.1") → è già assoluto, invariato;
 *   2. se l'id inizia per "1.2." → arco iso.member-body, riconoscibile come non-enterprise → assoluto, invariato;
 *   3. altrimenti → relativo all'arco enterprise, si antepone "1.3.6.1.4.1.".
 * Questa regola copre i casi osservati nel dataset verificato il 2026-07-28 (11 righe nel ramo
 * "1.2.", 4 righe già "1.3.6.1", il resto relativo) ma è euristica: un id come "1.1.1.55" (arco
 * iso.registration-authority, anch'esso teoricamente assoluto) NON è riconosciuto come tale e
 * finisce trattato come relativo. È un limite noto e documentato, non un bug silenzioso — lo
 * script conta e stampa quante righe finiscono in ciascun ramo.
 *
 * Uso:
 *   tsx scripts/build-attribution-kb.ts --offline <dir>   # <dir> deve contenere manuf.txt e sysobject.ids
 *   tsx scripts/build-attribution-kb.ts                   # scarica dai due URL sopra via fetch()
 *   tsx scripts/build-attribution-kb.ts --offline <dir> --out <path.sqlite>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

// ═══════════════════════════════════════════════════════════════════════════
// Sorgenti
// ═══════════════════════════════════════════════════════════════════════════

const MANUF_URL = "https://www.wireshark.org/download/automated/data/manuf";
const MANUF_LICENSE = "GPL-2.0";
const SYSOBJ_URL = "https://raw.githubusercontent.com/glpi-project/sysobject.ids/master/sysobject.ids";
const SYSOBJ_LICENSE = "GPL-2.0";

const OFFLINE_MANUF_FILENAME = "manuf.txt";
const OFFLINE_SYSOBJ_FILENAME = "sysobject.ids";

// ═══════════════════════════════════════════════════════════════════════════
// Parsing puro — MAC / manuf
// ═══════════════════════════════════════════════════════════════════════════

export interface ParsedOuiRow {
  prefix: string; // esadecimale maiuscolo senza separatori, troncato alle cifre significative
  bits: 24 | 28 | 36;
  vendorShort: string;
  vendorName: string;
}

/**
 * Normalizza un prefisso MAC nel formato `manuf` (con eventuale suffisso `/28` o `/36`)
 * nella forma esadecimale maiuscola senza separatori, troncata alle sole cifre
 * significative: 6 per 24 bit, 7 per 28 bit, 9 per 36 bit.
 * Ritorna `null` se il prefisso non è esadecimale valido o i bit non sono 24/28/36.
 */
export function normalizeMacPrefix(raw: string): { prefix: string; bits: 24 | 28 | 36 } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slashMatch = trimmed.match(/^(.*)\/(\d+)$/);
  const macPart = slashMatch ? slashMatch[1] : trimmed;
  const bitsNum = slashMatch ? Number(slashMatch[2]) : 24;
  if (bitsNum !== 24 && bitsNum !== 28 && bitsNum !== 36) return null;

  const hex = macPart.replace(/[:\-]/g, "").toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex)) return null;

  const requiredLen = bitsNum / 4; // 6, 7, 9
  if (hex.length < requiredLen) return null;

  return { prefix: hex.slice(0, requiredLen), bits: bitsNum as 24 | 28 | 36 };
}

/**
 * Parsa una riga del file `manuf` (TSV: prefisso, nome breve, nome completo opzionale).
 * Ritorna `null` per righe vuote, commenti (`#...`) o malformate (prefisso non valido,
 * campo obbligatorio mancante) — il chiamante è responsabile di distinguere e contare
 * le tre categorie di scarto per il riepilogo.
 */
export function parseManufLine(line: string): ParsedOuiRow | null {
  const fields = line.split("\t").map((f) => f.trim());
  if (fields.length < 2) return null;

  const [rawPrefix, vendorShort, vendorNameRaw] = fields;
  if (!rawPrefix || !vendorShort) return null;

  const normalized = normalizeMacPrefix(rawPrefix);
  if (!normalized) return null;

  const vendorName = vendorNameRaw && vendorNameRaw.length > 0 ? vendorNameRaw : vendorShort;

  return { prefix: normalized.prefix, bits: normalized.bits, vendorShort, vendorName };
}

// ═══════════════════════════════════════════════════════════════════════════
// Parsing puro — sysObjectID / GLPI
// ═══════════════════════════════════════════════════════════════════════════

export interface ParsedSysObjRow {
  oid: string; // sempre in forma assoluta dopo normalizeSysObjId
  vendor: string;
  glpiType: string | null;
  model: string | null;
}

/**
 * Normalizza un id sysObjectID in forma assoluta. Vedi la REGOLA documentata in testa al file.
 * Ritorna `null` se l'id non è una sequenza numerica puntata valida (es. testo libero).
 */
export function normalizeSysObjId(rawId: string): string | null {
  const id = rawId.trim();
  if (!/^\d+(\.\d+)*$/.test(id)) return null;

  if (id === "1.3.6.1" || id.startsWith("1.3.6.1.")) return id; // già assoluto (arco internet)
  if (id.startsWith("1.2.")) return id; // già assoluto (arco iso.member-body, riconoscibile)

  return `1.3.6.1.4.1.${id}`; // relativo → antepone l'arco enterprise
}

/**
 * Parsa una riga del file `sysobject.ids` (TSV: id, vendor, TYPE, modello, modulo).
 * `TYPE` e `modello` sono opzionali (righe con solo id+vendor esistono nel dataset reale).
 * Un TYPE non riconosciuto viene comunque accettato: il mapping TYPE→categoria v2 è
 * responsabilità del modulo di lookup (Task 2), non di questo script — non va congelato
 * qui dentro. Ritorna `null` per righe vuote, commenti o con id/vendor mancanti/non validi.
 */
export function parseSysObjLine(line: string): ParsedSysObjRow | null {
  const fields = line.split("\t").map((f) => f.trim());
  if (fields.length < 2) return null;

  const [rawId, vendor, glpiTypeRaw, modelRaw] = fields;
  if (!rawId || !vendor) return null;

  const oid = normalizeSysObjId(rawId);
  if (!oid) return null;

  const glpiType = glpiTypeRaw && glpiTypeRaw.length > 0 ? glpiTypeRaw : null;
  const model = modelRaw && modelRaw.length > 0 ? modelRaw : null;

  return { oid, vendor, glpiType, model };
}

// ═══════════════════════════════════════════════════════════════════════════
// I/O — offline o fetch
// ═══════════════════════════════════════════════════════════════════════════

interface Args {
  offlineDir: string | null;
  outPath: string;
}

function parseArgs(argv: string[]): Args {
  let offlineDir: string | null = null;
  let outPath = path.join(process.cwd(), "data", "attribution-kb.sqlite");

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offline") {
      offlineDir = argv[++i] ?? null;
    } else if (argv[i] === "--out") {
      outPath = path.resolve(argv[++i] ?? outPath);
    }
  }

  return { offlineDir, outPath };
}

async function loadSource(
  offlineDir: string | null,
  offlineFilename: string,
  url: string,
): Promise<string> {
  if (offlineDir) {
    const filePath = path.join(offlineDir, offlineFilename);
    return fs.readFileSync(filePath, "utf-8");
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download fallito per ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

/** Divide il contenuto in righe, scartando l'ultima riga vuota residua se il file termina con newline. */
function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Categorizzazione righe (comment / blank / ok / malformed) — non pura per I/O
// dei contatori, ma delega tutto il parsing dato-dipendente alle funzioni pure sopra.
// ═══════════════════════════════════════════════════════════════════════════

interface LineStats {
  read: number;
  comments: number;
  blank: number;
  malformed: number;
  ok: number;
}

function newLineStats(): LineStats {
  return { read: 0, comments: 0, blank: 0, malformed: 0, ok: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const { offlineDir, outPath } = parseArgs(process.argv.slice(2));

  console.log(
    offlineDir
      ? `Modalità offline — sorgenti da: ${offlineDir}`
      : "Modalità online — download via fetch() dai due URL sorgente",
  );

  const [manufContent, sysobjContent] = await Promise.all([
    loadSource(offlineDir, OFFLINE_MANUF_FILENAME, MANUF_URL),
    loadSource(offlineDir, OFFLINE_SYSOBJ_FILENAME, SYSOBJ_URL),
  ]);

  // ── manuf ──
  const manufStats = newLineStats();
  const ouiRows: ParsedOuiRow[] = [];
  for (const line of splitLines(manufContent)) {
    manufStats.read++;
    const trimmed = line.trim();
    if (!trimmed) {
      manufStats.blank++;
      continue;
    }
    if (trimmed.startsWith("#")) {
      manufStats.comments++;
      continue;
    }
    const parsed = parseManufLine(line);
    if (!parsed) {
      manufStats.malformed++;
      continue;
    }
    manufStats.ok++;
    ouiRows.push(parsed);
  }

  // ── sysobject.ids ──
  const sysobjStats = newLineStats();
  const sysobjRows: ParsedSysObjRow[] = [];
  let branchAbs368 = 0; // id già assoluto, arco 1.3.6.1
  let branchAbs12 = 0; // id già assoluto, arco 1.2.
  let branchRelative = 0; // id relativo, arco enterprise anteposto
  for (const line of splitLines(sysobjContent)) {
    sysobjStats.read++;
    const trimmed = line.trim();
    if (!trimmed) {
      sysobjStats.blank++;
      continue;
    }
    if (trimmed.startsWith("#")) {
      sysobjStats.comments++;
      continue;
    }
    const parsed = parseSysObjLine(line);
    if (!parsed) {
      sysobjStats.malformed++;
      continue;
    }
    sysobjStats.ok++;
    sysobjRows.push(parsed);

    const rawId = line.split("\t")[0].trim();
    if (rawId === "1.3.6.1" || rawId.startsWith("1.3.6.1.")) branchAbs368++;
    else if (rawId.startsWith("1.2.")) branchAbs12++;
    else branchRelative++;
  }

  // ── Scrittura artefatto ──
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(outPath + ext);
    } catch {
      /* assente */
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const db = new Database(outPath);
  db.pragma("journal_mode = WAL"); // veloce in scrittura; torna a DELETE prima di chiudere

  db.exec(`
    CREATE TABLE kb_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE oui (
      prefix TEXT PRIMARY KEY,
      bits INTEGER NOT NULL,
      vendor_short TEXT,
      vendor_name TEXT NOT NULL
    );
    CREATE INDEX idx_oui_bits ON oui(bits);
    CREATE TABLE sysobj (
      oid TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      glpi_type TEXT,
      model TEXT
    );
  `);

  const insertOui = db.prepare(
    `INSERT OR IGNORE INTO oui (prefix, bits, vendor_short, vendor_name) VALUES (?, ?, ?, ?)`,
  );
  const insertSysobj = db.prepare(
    `INSERT OR IGNORE INTO sysobj (oid, vendor, glpi_type, model) VALUES (?, ?, ?, ?)`,
  );
  const insertMeta = db.prepare(`INSERT INTO kb_meta (key, value) VALUES (?, ?)`);

  let ouiInserted = 0;
  let ouiConflicts = 0;
  let sysobjInserted = 0;
  let sysobjConflicts = 0;

  const insertAll = db.transaction(() => {
    for (const row of ouiRows) {
      const result = insertOui.run(row.prefix, row.bits, row.vendorShort, row.vendorName);
      if (result.changes > 0) ouiInserted++;
      else ouiConflicts++;
    }
    for (const row of sysobjRows) {
      const result = insertSysobj.run(row.oid, row.vendor, row.glpiType, row.model);
      if (result.changes > 0) sysobjInserted++;
      else sysobjConflicts++;
    }

    const generatedAt = new Date().toISOString();
    insertMeta.run("version", generatedAt);
    insertMeta.run("generated_at", generatedAt);
    insertMeta.run("source_manuf_url", MANUF_URL);
    insertMeta.run("source_manuf_license", MANUF_LICENSE);
    insertMeta.run("source_sysobject_url", SYSOBJ_URL);
    insertMeta.run("source_sysobject_license", SYSOBJ_LICENSE);
  });
  insertAll();

  // Artefatto compatto: niente WAL residuo, file unico.
  db.pragma("journal_mode = DELETE");
  db.exec("VACUUM");
  db.close();

  for (const ext of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(outPath + ext);
    } catch {
      /* assente */
    }
  }

  const sizeBytes = fs.statSync(outPath).size;
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);

  console.log("");
  console.log("═══ Riepilogo build KB attribuzione ═══");
  console.log("");
  console.log("manuf (OUI):");
  console.log(`  righe lette:      ${manufStats.read}`);
  console.log(`  commenti:         ${manufStats.comments}`);
  console.log(`  righe vuote:      ${manufStats.blank}`);
  console.log(`  malformate:       ${manufStats.malformed}`);
  console.log(`  valide:           ${manufStats.ok}`);
  console.log(`  inserite in oui:  ${ouiInserted}${ouiConflicts > 0 ? ` (conflitti PK scartati: ${ouiConflicts})` : ""}`);
  console.log("");
  console.log("sysobject.ids:");
  console.log(`  righe lette:      ${sysobjStats.read}`);
  console.log(`  commenti:         ${sysobjStats.comments}`);
  console.log(`  righe vuote:      ${sysobjStats.blank}`);
  console.log(`  malformate:       ${sysobjStats.malformed}`);
  console.log(`  valide:           ${sysobjStats.ok}`);
  console.log(`  inserite in sysobj: ${sysobjInserted}${sysobjConflicts > 0 ? ` (conflitti PK scartati: ${sysobjConflicts})` : ""}`);
  console.log(`  ramo assoluto 1.3.6.1: ${branchAbs368}`);
  console.log(`  ramo assoluto 1.2.:    ${branchAbs12}`);
  console.log(`  ramo relativo (enterprise anteposto): ${branchRelative}`);
  console.log("");
  console.log(`Artefatto: ${outPath}`);
  console.log(`Dimensione finale: ${sizeBytes} byte (${sizeMb} MB)`);
}

// Esegue main() SOLO se il file è invocato direttamente come script (tsx scripts/build-attribution-kb.ts),
// non quando è importato altrove (es. dal test delle funzioni pure) — altrimenti l'import
// scatenerebbe un download di rete + una scrittura reale dell'artefatto come side effect.
const isMainModule =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
