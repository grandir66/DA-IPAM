// scripts/import-tenant.ts
// Uso: node --import tsx --env-file=.env.local scripts/import-tenant.ts <FILE.dab> <TENANT_CODE> [--wipe] [--passphrase XXX]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDataDir } from "../src/lib/data-dir";
import { importTenant } from "../src/lib/transfer/import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

function main() {
  const file = process.argv[2];
  const tenantCode = process.argv[3];
  if (!file || !tenantCode || file.startsWith("--") || tenantCode.startsWith("--")) {
    console.error("Uso: import-tenant <FILE.dab> <TENANT_CODE> [--wipe] [--passphrase XXX]");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY non in env. Esegui con: node --import tsx --env-file=.env.local ...");
    process.exit(1);
  }
  const passphrase = arg("passphrase") || process.env.TRANSFER_PASSPHRASE;
  if (!passphrase) { console.error("Passphrase mancante (--passphrase o TRANSFER_PASSPHRASE)"); process.exit(1); }

  const dataDir = resolveDataDir();
  const tenantsDir = path.join(dataDir, "tenants");
  fs.mkdirSync(tenantsDir, { recursive: true });
  const tenantPath = path.join(tenantsDir, `${tenantCode}.db`);
  const hubPath = path.join(dataDir, "hub.db");

  // Il DB tenant DEVE esistere con lo schema già applicato. Se non esiste,
  // l'app lo crea al primo avvio: qui esigiamo che esista (DR: prima si avvia
  // l'app una volta su install pulito, poi si importa a server spento).
  if (!fs.existsSync(tenantPath)) {
    console.error(`DB tenant ${tenantPath} inesistente. Avvia l'app una volta per crearlo, poi reimporta.`);
    process.exit(1);
  }

  const bundle = fs.readFileSync(file);
  const tenantDb = new Database(tenantPath);
  const hubDb = new Database(hubPath);
  try {
    const res = importTenant({
      bundle, tenantDb, hubDb,
      options: { tenantCode, passphrase, wipe: flag("wipe") },
    });
    console.log("OK import:", JSON.stringify(res, null, 2));
  } finally {
    tenantDb.close(); hubDb.close();
  }
}
main();
