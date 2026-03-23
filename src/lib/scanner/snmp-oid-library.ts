/**
 * Libreria OID esterna: file JSON sotto `config/snmp-oid-library/`
 * - `common.json` — OID fondamentali di riferimento (MIB-II, ENTITY, …), solo documentazione / UI
 * - `categories/<categoria>.json` — OID condivisi per classificazione (es. storage, firewall)
 * - `devices/<profile_id>.json` — OID lunghi specifici del profilo (merge sopra DB + categoria)
 *
 * Aggiungere un nuovo file in `devices/` o `categories/` aggiorna l’elenco al prossimo caricamento (cache invalidata via revision).
 */

import fs from "fs";
import path from "path";

const LIBRARY_DIR = path.join(process.cwd(), "config", "snmp-oid-library");
const COMMON_FILE = "common.json";
const DIR_CATEGORIES = "categories";
const DIR_DEVICES = "devices";

export interface SnmpOidLibraryCommonFile {
  version?: number;
  title?: string;
  description?: string;
  /** OID di riferimento (non mergiati automaticamente sui profili; tab di consultazione) */
  fundamental?: Record<string, string | string[]>;
  /** Gruppi opzionali per UI */
  groups?: Array<{ id: string; label: string; fields: Record<string, string | string[]> }>;
}

export interface SnmpOidLibraryCategoryFile {
  category: string;
  /** Mergiati su tutti i profili con questa categoria (dopo campi DB) */
  fields?: Record<string, string | string[]>;
  note?: string | null;
}

export interface SnmpOidLibraryDeviceFile {
  profile_id: string;
  /** OID estesi (liste lunghe); sovrascrivono stessa chiave da DB/categoria */
  device_specific?: Record<string, string | string[]>;
  note?: string | null;
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json") && !d.name.endsWith(".example.json"))
    .map((d) => path.join(dir, d.name));
}

/** Revisione libreria (per invalidare cache profili SNMP quando cambia un file). */
export function getSnmpOidLibraryRevision(): string {
  try {
    if (!fs.existsSync(LIBRARY_DIR)) return "0";
    const files: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name.endsWith(".json")) files.push(p);
      }
    };
    walk(LIBRARY_DIR);
    let sum = 0;
    for (const f of files) {
      try {
        sum += fs.statSync(f).mtimeMs;
      } catch {
        /* ignore */
      }
    }
    return `${files.length}:${Math.floor(sum)}`;
  } catch {
    return "0";
  }
}

export function loadSnmpOidLibraryCommon(): SnmpOidLibraryCommonFile | null {
  const p = path.join(LIBRARY_DIR, COMMON_FILE);
  if (!fs.existsSync(p)) return null;
  return safeReadJson<SnmpOidLibraryCommonFile>(p);
}

/** Campi da file categoria → merge per profile.category */
export function loadCategoryOidFields(category: string): Record<string, string | string[]> {
  const p = path.join(LIBRARY_DIR, DIR_CATEGORIES, `${category}.json`);
  if (!fs.existsSync(p)) return {};
  const data = safeReadJson<SnmpOidLibraryCategoryFile>(p);
  if (!data?.fields || typeof data.fields !== "object") return {};
  return { ...data.fields };
}

/** Campi device_specific da file dedicato al profile_id */
export function loadDeviceOidFields(profileId: string): Record<string, string | string[]> {
  const p = path.join(LIBRARY_DIR, DIR_DEVICES, `${profileId}.json`);
  if (!fs.existsSync(p)) return {};
  const data = safeReadJson<SnmpOidLibraryDeviceFile>(p);
  if (!data?.device_specific || typeof data.device_specific !== "object") return {};
  return { ...data.device_specific };
}

export type OidLibraryFileEntry =
  | { kind: "common"; name: string; path: string }
  | { kind: "category"; name: string; path: string; category: string }
  | { kind: "device"; name: string; path: string; profile_id: string; fieldCount: number };

/** Elenco file per API / UI (si aggiorna aggiungendo file nella cartella). */
export function listSnmpOidLibraryFiles(): OidLibraryFileEntry[] {
  const out: OidLibraryFileEntry[] = [];
  const commonPath = path.join(LIBRARY_DIR, COMMON_FILE);
  if (fs.existsSync(commonPath)) {
    out.push({ kind: "common", name: COMMON_FILE, path: "config/snmp-oid-library/common.json" });
  }
  for (const f of listJsonFiles(path.join(LIBRARY_DIR, DIR_CATEGORIES))) {
    const base = path.basename(f, ".json");
    out.push({ kind: "category", name: path.basename(f), path: `config/snmp-oid-library/categories/${path.basename(f)}`, category: base });
  }
  for (const f of listJsonFiles(path.join(LIBRARY_DIR, DIR_DEVICES))) {
    const base = path.basename(f, ".json");
    const data = safeReadJson<SnmpOidLibraryDeviceFile>(f);
    const n = data?.device_specific ? Object.keys(data.device_specific).length : 0;
    out.push({
      kind: "device",
      name: path.basename(f),
      path: `config/snmp-oid-library/devices/${path.basename(f)}`,
      profile_id: data?.profile_id ?? base,
      fieldCount: n,
    });
  }
  return out;
}

/**
 * Merge: DB fields → category file → device file (chiavi successive vincono).
 */
export function mergeProfileFieldsWithOidLibrary(
  profileId: string,
  category: string,
  dbFields: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const base = { ...dbFields } as Record<string, string | string | string[] | undefined>;
  const cat = loadCategoryOidFields(category);
  const dev = loadDeviceOidFields(profileId);
  return { ...base, ...cat, ...dev };
}
