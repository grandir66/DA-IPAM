// Cartella dati di prova, una per processo: un file di test lo importa PER
// PRIMO, prima di db, db-hub e db-tenant, che fissano i percorsi al caricamento
// (vedi integrations/__tests__/support/hub-isolato.ts per il perché misurato).
// Senza, `getDb()` e `getTenantDb()` lavorerebbero in `<cwd>/data`: sulla
// macchina di sviluppo è un hub vero.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-data-dir-isolata";

export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "da-ipam-test-data-"));
process.env.DA_INVENT_DATA_DIR = TEST_DATA_DIR;
delete process.env.DA_IPAM_HUB_DB_PATH;
delete process.env.DA_IPAM_DB_PATH;
