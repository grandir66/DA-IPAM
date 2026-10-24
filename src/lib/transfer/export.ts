// src/lib/transfer/export.ts
import zlib from "zlib";
import type Database from "better-sqlite3";
import type { BundleManifest, ExportOptions } from "./types";
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from "./types";
import { tablesForTiers } from "./table-registry";
import { writableColumns, rekeyColumns } from "./schema-introspect";
import {
  randomSalt, deriveTransportKey, encryptFieldWithKey, encryptBuffer, writeContainer,
} from "./envelope";
import { safeDecrypt } from "@/lib/crypto";
import { campiVoceDb, COLONNA_DEL_CAMPO, COLONNE_SEGRETE, type CampoSegreto } from "@/lib/credentials/segreti";
import { vaultOpenBaoAcceso } from "@/lib/vault/stato";
import { encryptionKeyFingerprint } from "@/lib/encryption-key-health";

export interface ExportArgs {
  tenantDb: Database.Database;
  hubDb: Database.Database;
  options: ExportOptions;
}

export function exportTenant(args: ExportArgs): Buffer {
  const { tenantDb, hubDb, options } = args;
  const salt = randomSalt();
  const transportKey = deriveTransportKey(options.passphrase, salt);

  const specs = tablesForTiers(options.tiers, options.includeVault);
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  let secretErrors = 0;

  for (const spec of specs) {
    const db = spec.scope === "tenant" ? tenantDb : hubDb;
    if (!tableExists(db, spec.table)) continue; // schema più vecchio: salta

    const cols = writableColumns(db, spec.table);
    const writableCols = new Set(cols);
    const rekeys = new Set([
      ...rekeyColumns(db, spec.table),
      ...(spec.secretColumns ?? []).filter((c) => writableCols.has(c)),
    ]);

    let sql = `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${spec.table}"`;
    const params: unknown[] = [];
    if (spec.scope === "hub-tenant" && spec.tenantColumn) {
      sql += ` WHERE "${spec.tenantColumn}" = ?`;
      params.push(options.tenantCode);
    }

    // da-vault (ADR 0035): con OpenBao acceso le colonne segrete di `credentials` sono vuote (i segreti stanno in OpenBao) e
    // il pacchetto deve portarli lo stesso. Si leggono dal lettore unico, come ogni altra lettura, e la voce del pacchetto
    // è autosufficiente (colonne piene, SENZA `credential_ref`: il percorso è del sorgente, non dell'installazione che importa).
    const daLettore = spec.table === "credentials" && spec.scope === "tenant" && vaultOpenBaoAcceso() && writableCols.has("id");

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    let n = 0;
    for (const row of rows) {
      if (daLettore) {
        const c = campiVoceDb(db, Number(row.id));
        const chiari: Record<string, string> = {};
        if (c.ok) {
          for (const [campo, colonna] of Object.entries(COLONNA_DEL_CAMPO) as Array<[CampoSegreto, string]>) {
            const v = c.campi[campo];
            if (v) chiari[colonna] = v;
          }
        } else {
          secretErrors++; // OpenBao non risponde o una colonna non si decifra: la voce parte senza segreto, e il pacchetto lo dice
        }
        for (const col of COLONNE_SEGRETE) {
          if (!writableCols.has(col)) continue;
          row[col] = chiari[col] !== undefined ? encryptFieldWithKey(chiari[col], transportKey) : null;
        }
        if (writableCols.has("credential_ref")) row.credential_ref = null;
      }
      for (const col of rekeys) {
        if (daLettore && COLONNE_SEGRETE.includes(col)) continue; // già nel pacchetto, cifrato per il trasporto
        const v = row[col];
        if (typeof v === "string" && v.length > 0) {
          const pt = safeDecrypt(v); // decifra con la chiave d'installazione sorgente
          if (pt === null) {
            secretErrors++;
            row[col] = null; // secret non recuperabile: lo scartiamo
          } else {
            row[col] = encryptFieldWithKey(pt, transportKey); // ri-wrap con transport key
          }
        }
      }
      lines.push(JSON.stringify({ tbl: spec.table, row }));
      n++;
    }
    counts[spec.table] = n;
  }

  const payloadPlain = Buffer.from(lines.join("\n"), "utf8");
  const gzipped = zlib.gzipSync(payloadPlain);
  const encryptedPayload = encryptBuffer(gzipped, transportKey);

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    appVersion: options.appVersion,
    exportedAt: options.exportedAt,
    tiers: options.tiers,
    includeVault: options.includeVault,
    tables: counts,
    secretErrors,
    encryption: {
      scheme: "envelope-aes-256-gcm",
      saltHex: salt.toString("hex"),
      sourceKeyFingerprint: encryptionKeyFingerprint(),
    },
  };

  return writeContainer(manifest, encryptedPayload);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
}
