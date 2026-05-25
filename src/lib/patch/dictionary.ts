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
 * Normalizza un nome software per matching: lowercase, strip suffix architettura
 * ("(64-bit)", "(x86)", " x64", " 64-bit") e strip version number trailing.
 *
 * Usato sia per cercare nel dictionary sia come chiave canonical durante il
 * confronto. Idempotente.
 */
export function normalizeSoftwareName(name: string): string {
  return name
    .toLowerCase()
    // Strip suffisso ARN/locale tipo "(x64 en-us)", "(x86 it-IT)", "(64-bit en-us)"
    .replace(/\s*\((?:x64|x86|64-bit|32-bit)\s+[a-z]{2,3}(?:[-_][a-z]{2,3})?\)/g, "")
    .replace(/\s*\(64-bit\)/g, "")
    .replace(/\s*\(32-bit\)/g, "")
    .replace(/\s*\(x86\)/g, "")
    .replace(/\s*\(x64\)/g, "")
    .replace(/\s+x64\b/g, "")
    .replace(/\s+x86\b/g, "")
    .replace(/\s+64-bit\b/g, "")
    .replace(/\s+32-bit\b/g, "")
    .replace(/\s+\d+(\.\d+)+(\.\d+)*/g, "")
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
