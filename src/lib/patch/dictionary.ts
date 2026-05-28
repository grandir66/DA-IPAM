/**
 * Dictionary CVE → Chocolatey package id.
 *
 * Sorgente: data/package-dictionary.json (seed maintenibile a mano).
 * Cache in-memory: loadDictionary() la legge una volta al primo accesso e
 * la riusa. Restart processo o clearDictionaryCache() per ricaricare.
 *
 * Pattern: questo modulo è puro (no DB), può essere usato sia dal matcher
 * (server-side, Node runtime) sia da tooling CLI eventuale.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface DictionaryEntry {
  /** Nome software lowercase normalizzato (chiave primaria del lookup). */
  name: string;
  /** Chocolatey package id (es. "firefox", "googlechrome"). */
  choco: string;
  /** Produttore, opzionale (best-effort, solo display). */
  vendor?: string;
  /** Nomi alternativi normalizzati (lowercase). Match esatto. */
  aliases?: string[];
}

interface DictionaryFile {
  version: number;
  generatedAt: string;
  description: string;
  entries: DictionaryEntry[];
}

let cachedDict: DictionaryEntry[] | null = null;

/**
 * Carica il dictionary da disco una volta sola e lo cacha in memoria.
 * In caso di errore (file mancante, JSON malformato, schema invalido)
 * ritorna [] e logga l'errore: il matcher continua a funzionare con
 * "no match" (UI mostrerà "?").
 */
export function loadDictionary(): DictionaryEntry[] {
  if (cachedDict) return cachedDict;
  try {
    const filePath = path.join(process.cwd(), "data", "package-dictionary.json");
    const raw = readFileSync(filePath, "utf-8");
    let parsed: DictionaryFile;
    try {
      parsed = JSON.parse(raw) as DictionaryFile;
    } catch (parseErr) {
      console.error("[patch/dictionary] JSON parse failed:", parseErr);
      cachedDict = [];
      return cachedDict;
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      console.error("[patch/dictionary] Invalid format, no entries array");
      cachedDict = [];
      return cachedDict;
    }
    cachedDict = parsed.entries;
    return cachedDict;
  } catch (err) {
    console.error("[patch/dictionary] Load failed:", err);
    cachedDict = [];
    return cachedDict;
  }
}

/**
 * Normalizza un nome software per matching: lowercase, strip suffix architettura,
 * suffisso locale, build/version, "Helper/Updater/Maintenance Service" e prefisso
 * "Microsoft" per prodotti noti. Idempotente.
 *
 * Esempi:
 *   "Mozilla Firefox 124.0 (x64 en-US)"   → "mozilla firefox"
 *   "Microsoft Edge"                        → "edge"
 *   "Java Maintenance Service"              → "java"
 *   "Adobe Acrobat Reader DC (en-US)"       → "adobe acrobat reader dc"
 *   "Windows 10 Build 19041"                → "windows 10"
 *   "x64 Photoshop CC 2024"                 → "photoshop cc"
 *
 * Mantenere i pattern restrittivi per evitare false positives (es. NON rimuovere
 * "Microsoft" generico, NON catturare parens 3+ char tipo "(GUI)" o "(SDK)").
 */
export function normalizeSoftwareName(name: string): string {
  return name
    .toLowerCase()
    // 1. Strip suffisso ARN+locale tipo "(x64 en-us)", "(x86 it-IT)", "(64-bit en-us)"
    .replace(/\s*\((?:x64|x86|64-bit|32-bit)\s+[a-z]{2,3}(?:[-_][a-z]{2,3})?\)/g, "")
    // 1b. Strip suffisso double-arch tipo "(64-bit x64)", "(32-bit x86)"
    .replace(/\s*\((?:64-bit|32-bit)\s+x(?:64|86)\)/g, "")
    // 2. Strip locale puro in parens: "(en-US)", "(it_IT)", "(de-de)" — solo 2 char + opz 2-4
    .replace(/\s*\([a-z]{2}(?:[-_][a-z]{2,4})?\)/g, "")
    // 2b. Strip pattern installer comuni: "(remove only)", "(machine - wv)", "(machine-wide)"
    .replace(/\s*\(remove only\)/g, "")
    .replace(/\s*\(machine[ -]wide\)/g, "")
    .replace(/\s*\(machine\s*-\s*wv\)/g, "")
    // 3. Strip arch in parens
    .replace(/\s*\(64-bit\)/g, "")
    .replace(/\s*\(32-bit\)/g, "")
    .replace(/\s*\(x86\)/g, "")
    .replace(/\s*\(x64\)/g, "")
    // 4. Strip arch trailing word
    .replace(/\s+x64\b/g, "")
    .replace(/\s+x86\b/g, "")
    .replace(/\s+64-bit\b/g, "")
    .replace(/\s+32-bit\b/g, "")
    .replace(/\s+amd64\b/g, "")
    // 5. Strip arch leading word: "x64 Photoshop", "amd64 Foo"
    .replace(/^(?:x64|x86|64-bit|32-bit|amd64)\s+/g, "")
    // 6. Strip "Build 19041", "Version 10.0", "Update 5"
    .replace(/\s+(?:build|version|update|release)\s+[\d.]+/g, "")
    // 7. Strip suffissi runtime/helper comuni
    .replace(/\s+(?:maintenance service|update helper|web helper|update tool|updater|helper|runtime)\b/g, "")
    // 8. Strip "by Vendor" trailing
    .replace(/\s+by\s+[a-z0-9 ,&.'-]+$/g, "")
    // 9. Strip prefix "Microsoft" solo per prodotti noti MS (case sicuro)
    .replace(/^microsoft\s+(?=edge|teams|office|defender|onedrive|onenote|skype|outlook|word|excel|powerpoint|visual studio|sql server)/g, "")
    // 10. Strip version trailing aggressivo: "10.0.19041", "2024.1.0"
    .replace(/\s+\d+(\.\d+){1,}(?:\s|$)/g, " ")
    // 11. Existing: version trailing semplice (mantenuto per compat)
    .replace(/\s+\d+(\.\d+)+(\.\d+)*/g, "")
    // 11b. Strip standalone year (1990-2099) come "Visual Studio 2019", "Office 2021"
    .replace(/\s+(?:19|20)\d{2}\b/g, "")
    // 11c. Strip leftover parens vuoti causati dalle strip precedenti
    .replace(/\s*\(\s*\)/g, "")
    // 12. Collassa spazi multipli causati dalle strip precedenti
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lookup esatto sul dictionary (match su `name` o uno dei suoi `aliases`).
 * Ritorna la prima entry che matcha o `null`.
 */
export function lookupExact(name: string): DictionaryEntry | null {
  const norm = normalizeSoftwareName(name);
  if (!norm) return null;
  const dict = loadDictionary();
  for (const e of dict) {
    if (e.name === norm) return e;
    if (e.aliases?.includes(norm)) return e;
  }
  return null;
}

/**
 * Distanza Levenshtein O(n*m). Usato solo per il fallback fuzzy con
 * maxDistance ≤ 2. Non esposto pubblicamente: chiamare lookupFuzzy.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + cost
      );
    }
  }
  return m[a.length][b.length];
}

/**
 * Lookup fuzzy con cap distanza Levenshtein (default 2, MAI > 2).
 * Ritorna la entry più vicina entro il cap o `null`. In caso di parità
 * vince la prima incontrata nell'array (ordinato alfabeticamente per `name`
 * nel seed, dunque deterministico).
 */
export function lookupFuzzy(name: string, maxDistance: number = 2): DictionaryEntry | null {
  if (maxDistance > 2) maxDistance = 2; // hard cap difensivo
  const norm = normalizeSoftwareName(name);
  if (!norm) return null;
  const dict = loadDictionary();
  let best: DictionaryEntry | null = null;
  let bestDist = maxDistance + 1;
  for (const e of dict) {
    const d = levenshtein(norm, e.name);
    if (d < bestDist) {
      bestDist = d;
      best = e;
      if (d === 0) break;
    }
  }
  if (best && bestDist <= maxDistance) return best;
  return null;
}

/**
 * Svuota la cache. Utile per test o per ricaricare il dictionary dopo edit
 * manuale del JSON in dev. In prod basta il restart del processo.
 */
export function clearDictionaryCache(): void {
  cachedDict = null;
}
