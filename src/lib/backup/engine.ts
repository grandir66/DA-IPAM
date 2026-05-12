/**
 * Backup engine — snapshot atomici di hub.db + tutti i tenant DB.
 *
 * Schedulato dal cron nightly (vedi `src/lib/backup/scheduler.ts`).
 * Può essere invocato anche manualmente via `POST /api/admin/backup-now`.
 *
 * Pattern:
 *   1. `sqlite3 <db> ".backup <out>"` — copia atomica live-friendly (gestisce WAL)
 *   2. gzip del file di output
 *   3. retention: elimina cartelle/file più vecchi di N giorni
 *
 * Output:
 *   /var/backups/da-invent/YYYY-MM-DD/hub.db.gz
 *   /var/backups/da-invent/YYYY-MM-DD/tenants/<code>.db.gz
 *   /var/backups/da-invent/YYYY-MM-DD/manifest.json
 *
 * `manifest.json` contiene: timestamp inizio/fine, file generati con SHA256,
 * versione hub, codici tenant. Usato per audit / verifica integrità in DR.
 */

import path from "path";
import fs from "fs";
import os from "os";
import zlib from "zlib";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCb);

export interface BackupFileEntry {
  source: string;
  output: string;
  size_bytes: number;
  sha256: string;
  ok: boolean;
  error?: string;
}

export interface BackupManifest {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  hub_version: string | null;
  hostname: string;
  files: BackupFileEntry[];
  errors: string[];
}

const DEFAULT_BACKUP_ROOT = "/var/backups/da-invent";
const DEFAULT_RETENTION_DAYS = 30;
const DATA_DIR = path.join(process.cwd(), "data");

function getBackupRoot(): string {
  return process.env.DA_INVENT_BACKUP_ROOT || DEFAULT_BACKUP_ROOT;
}

function getRetentionDays(): number {
  const v = Number(process.env.DA_INVENT_BACKUP_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RETENTION_DAYS;
}

function getHubVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Esegue `sqlite3 <dbPath> ".backup <outPath>"` come subprocess. Atomico,
 * live-friendly (gestisce correttamente il WAL).
 */
async function sqliteBackup(dbPath: string, outPath: string): Promise<void> {
  // sqlite3 CLI vuole il path di output come argomento del comando .backup
  await execFile("sqlite3", [dbPath, `.backup '${outPath.replace(/'/g, "'\\''")}'`], {
    timeout: 60_000,
  });
}

async function gzipFile(srcPath: string, destPath: string): Promise<void> {
  const read = fs.createReadStream(srcPath);
  const write = fs.createWriteStream(destPath);
  const gz = zlib.createGzip({ level: 6 });
  await pipeline(read, gz, write);
}

/**
 * Backup di un singolo file SQLite. Crea uno snapshot atomico in temp dir,
 * lo comprime in `dest`, restituisce metadati per il manifest.
 */
async function backupOne(label: string, source: string, dest: string): Promise<BackupFileEntry> {
  const entry: BackupFileEntry = {
    source,
    output: dest,
    size_bytes: 0,
    sha256: "",
    ok: false,
  };

  if (!fs.existsSync(source)) {
    entry.error = `source non esiste: ${source}`;
    return entry;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `da-invent-backup-${label}-`));
  const tmpSnapshot = path.join(tmpDir, `${label}.db`);

  try {
    await sqliteBackup(source, tmpSnapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o750 });
    await gzipFile(tmpSnapshot, dest);

    const st = fs.statSync(dest);
    entry.size_bytes = st.size;
    entry.sha256 = await sha256File(dest);
    entry.ok = true;
  } catch (e) {
    entry.error = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return entry;
}

/**
 * Elimina cartelle dated più vecchie di `retentionDays`.
 * Convenzione: ogni run scrive in `<root>/YYYY-MM-DD/`. Si parsa il nome
 * della dir; tutto ciò che non matcha viene ignorato (compresi backup manuali
 * scritti altrove).
 */
function applyRetention(root: string, retentionDays: number): { kept: number; deleted: number } {
  if (!fs.existsSync(root)) return { kept: 0, deleted: 0 };
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let kept = 0;
  let deleted = 0;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const st = fs.statSync(full);
    if (!st.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
      kept++;
      continue;
    }
    // Cutoff sul mtime per essere robusto a clock skew nel naming
    if (st.mtimeMs < cutoff) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        deleted++;
      } catch {
        kept++;
      }
    } else {
      kept++;
    }
  }
  return { kept, deleted };
}

/**
 * Run completo: hub.db + tutti i tenant DB.
 *
 * `tenantCodes`: lista dei codice_cliente per cui esiste `<DATA_DIR>/tenants/<code>.db`.
 * Idealmente passata da chi conosce il registry tenant (db-hub).
 */
export async function runHubBackup(tenantCodes: string[] = []): Promise<BackupManifest> {
  const started = new Date();
  const today = started.toISOString().slice(0, 10);
  const root = getBackupRoot();
  const outDir = path.join(root, today);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o750 });

  const manifest: BackupManifest = {
    started_at: started.toISOString(),
    finished_at: "",
    duration_ms: 0,
    hub_version: getHubVersion(),
    hostname: os.hostname(),
    files: [],
    errors: [],
  };

  // Hub DB
  const hubSrc = path.join(DATA_DIR, "hub.db");
  manifest.files.push(await backupOne("hub", hubSrc, path.join(outDir, "hub.db.gz")));

  // Tenant DBs
  const tenantOutDir = path.join(outDir, "tenants");
  for (const code of tenantCodes) {
    const src = path.join(DATA_DIR, "tenants", `${code}.db`);
    const dest = path.join(tenantOutDir, `${code}.db.gz`);
    manifest.files.push(await backupOne(`tenant-${code}`, src, dest));
  }

  // Manifest
  const finished = new Date();
  manifest.finished_at = finished.toISOString();
  manifest.duration_ms = finished.getTime() - started.getTime();
  manifest.errors = manifest.files.filter((f) => !f.ok).map((f) => `${f.source}: ${f.error}`);

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), {
    mode: 0o640,
  });

  // Retention
  const ret = applyRetention(root, getRetentionDays());
  console.info(
    `[backup] completato: ${manifest.files.filter((f) => f.ok).length}/${manifest.files.length} file ok in ${manifest.duration_ms}ms. Retention: ${ret.deleted} eliminati, ${ret.kept} mantenuti.`,
  );

  return manifest;
}
