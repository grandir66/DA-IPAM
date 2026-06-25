// scripts/export-tenant.ts
// Uso: node --import tsx --env-file=.env.local scripts/export-tenant.ts <TENANT_CODE> [--out file.dab] [--tiers asset,mirror,history] [--vault] [--passphrase XXX]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDataDir } from "../src/lib/data-dir";
import { exportTenant } from "../src/lib/transfer/export";
import type { Tier } from "../src/lib/transfer/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

function main() {
  const tenantCode = process.argv[2];
  if (!tenantCode || tenantCode.startsWith("--")) {
    console.error("Uso: export-tenant <TENANT_CODE> [--out f.dab] [--tiers asset,mirror] [--vault] [--passphrase XXX]");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY non in env. Esegui con: node --import tsx --env-file=.env.local ...");
    process.exit(1);
  }
  const passphrase = arg("passphrase") || process.env.TRANSFER_PASSPHRASE;
  if (!passphrase) { console.error("Passphrase mancante (--passphrase o TRANSFER_PASSPHRASE)"); process.exit(1); }

  const dataDir = resolveDataDir();
  const tenantPath = path.join(dataDir, "tenants", `${tenantCode}.db`);
  const hubPath = path.join(dataDir, "hub.db");
  if (!fs.existsSync(tenantPath)) { console.error(`DB tenant non trovato: ${tenantPath}`); process.exit(1); }

  const tiers = (arg("tiers")?.split(",").map((s) => s.trim()).filter(Boolean) as Tier[]) || (["asset", "mirror"] as Tier[]);
  const tenantDb = new Database(tenantPath, { readonly: true });
  const hubDb = new Database(hubPath, { readonly: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  const exportedAt = new Date().toISOString();
  const bundle = exportTenant({
    tenantDb, hubDb,
    options: { tenantCode, tiers, includeVault: flag("vault"), passphrase, exportedAt, appVersion: pkg.version },
  });

  const outPath = arg("out") || `${tenantCode}-${exportedAt.replace(/[:.]/g, "-")}.dab`;
  fs.writeFileSync(outPath, bundle);
  tenantDb.close(); hubDb.close();
  console.log(`OK: ${outPath} (${(bundle.length / 1024).toFixed(1)} KB)`);
}
main();
