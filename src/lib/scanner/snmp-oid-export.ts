/**
 * Esportazione profili SNMP dal database in cartelle/file JSON coerenti con
 * `config/snmp-oid-library/` (devices/, categories/, manifest).
 */

import fs from "fs";
import path from "path";
import type { SnmpVendorProfileRow } from "@/lib/db";

export interface SnmpOidExportResult {
  /** Percorso assoluto della cartella creata */
  rootDir: string;
  /** Percorso relativo a process.cwd() */
  rootRelative: string;
  manifest: SnmpOidExportManifest;
  filesWritten: string[];
}

export interface SnmpOidExportManifest {
  export_version: number;
  exported_at: string;
  profile_count: number;
  categories: string[];
  structure: {
    devices: string;
    profiles_complete: string;
    categories: string;
  };
}

function safeProfileFileName(profileId: string): string {
  if (!/^[a-z0-9_-]+$/i.test(profileId)) {
    return profileId.replace(/[^a-z0-9_-]/gi, "_") || "profile";
  }
  return profileId;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * Scrive sotto `baseDataDir` (tipicamente `data/`) una cartella `snmp-oid-export-<ISO>/`
 * con layout coerente con la libreria OID file-based.
 */
export function exportSnmpProfilesFromDbToFiles(
  baseDataDir: string,
  profiles: SnmpVendorProfileRow[]
): SnmpOidExportResult {
  const exportedAt = new Date().toISOString();
  const folderName = `snmp-oid-export-${exportedAt.replace(/[:.]/g, "-")}`;
  const rootDir = path.join(baseDataDir, folderName);
  const devicesDir = path.join(rootDir, "devices");
  const completeDir = path.join(rootDir, "profiles_complete");
  const categoriesDir = path.join(rootDir, "categories");

  fs.mkdirSync(devicesDir, { recursive: true });
  fs.mkdirSync(completeDir, { recursive: true });
  fs.mkdirSync(categoriesDir, { recursive: true });

  const byCategory = new Map<string, string[]>();
  const filesWritten: string[] = [];

  for (const p of profiles) {
    const ids = byCategory.get(p.category) ?? [];
    ids.push(p.profile_id);
    byCategory.set(p.category, ids);

    let fieldsObj: Record<string, string | string[]> = {};
    try {
      fieldsObj = JSON.parse(p.fields || "{}") as Record<string, string | string[]>;
    } catch {
      /* ignore */
    }

    const baseName = safeProfileFileName(p.profile_id);

    /** Formato allineato a `config/snmp-oid-library/devices/*.json` */
    const deviceFile = {
      profile_id: p.profile_id,
      name: p.name,
      category: p.category,
      exported_from_database: true,
      exported_at: exportedAt,
      note: p.note,
      device_specific: fieldsObj,
    };
    const devPath = path.join(devicesDir, `${baseName}.json`);
    writeJson(devPath, deviceFile);
    filesWritten.push(path.relative(process.cwd(), devPath));

    let prefixes: string[] = [];
    try {
      const pr = JSON.parse(p.enterprise_oid_prefixes || "[]");
      if (Array.isArray(pr)) prefixes = pr;
    } catch {
      /* ignore */
    }

    const complete = {
      profile_id: p.profile_id,
      name: p.name,
      category: p.category,
      enterprise_oid_prefixes: prefixes,
      sysdescr_pattern: p.sysdescr_pattern,
      fields: fieldsObj,
      confidence: p.confidence,
      enabled: p.enabled === 1,
      builtin: p.builtin === 1,
      note: p.note,
      database: { id: p.id, created_at: p.created_at, updated_at: p.updated_at },
    };
    const compPath = path.join(completeDir, `${baseName}.json`);
    writeJson(compPath, complete);
    filesWritten.push(path.relative(process.cwd(), compPath));
  }

  for (const [cat, profileIds] of byCategory) {
    const safeCat = safeProfileFileName(cat);
    const catPayload = {
      category: cat,
      profile_ids: [...new Set(profileIds)].sort(),
      note:
        "Indice generato dall’esportazione DB. Per OID condivisi tra tutti i profili di questa categoria, aggiungi qui il campo `fields` (stesso formato della libreria OID).",
      fields: {} as Record<string, string | string[]>,
    };
    const catPath = path.join(categoriesDir, `${safeCat}.json`);
    writeJson(catPath, catPayload);
    filesWritten.push(path.relative(process.cwd(), catPath));
  }

  const manifest: SnmpOidExportManifest = {
    export_version: 1,
    exported_at: exportedAt,
    profile_count: profiles.length,
    categories: [...byCategory.keys()].sort(),
    structure: {
      devices:
        "Stesso significato di config/snmp-oid-library/devices/ — device_specific = campi OID salvati nel DB per quel profilo.",
      profiles_complete:
        "Snapshot completo (prefissi enterprise, sysDescr, confidence, flags) utile per backup o confronto.",
      categories:
        "Elenco profile_id per classificazione; puoi arricchire `fields` a mano per OID condivisi.",
    },
  };
  const manifestPath = path.join(rootDir, "manifest.json");
  writeJson(manifestPath, manifest);
  filesWritten.unshift(path.relative(process.cwd(), manifestPath));

  const readmePath = path.join(rootDir, "README.txt");
  const readme = `Esportazione profili SNMP da DA-IPAM
Generata: ${exportedAt}
Profili: ${profiles.length}

Cartelle:
- devices/     → formato libreria OID (device_specific = OID dal database)
- profiles_complete/ → tutti i metadati profilo (backup)
- categories/  → indice per classificazione

Puoi copiare file da devices/ verso config/snmp-oid-library/devices/ se vuoi
usarli come template versionati (verifica conflitti con merge runtime).

`;
  fs.writeFileSync(readmePath, readme, "utf8");
  filesWritten.push(path.relative(process.cwd(), readmePath));

  return {
    rootDir,
    rootRelative: path.relative(process.cwd(), rootDir),
    manifest,
    filesWritten,
  };
}
