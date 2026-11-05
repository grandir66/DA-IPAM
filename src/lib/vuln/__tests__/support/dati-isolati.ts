// Cartella dati di prova, una per processo: un file di test la importa PER PRIMO (prima di db-tenant e
// db-hub, che fissano il percorso quando vengono caricati). Senza, `npm test` lanciato senza
// DA_INVENT_DATA_DIR creerebbe il tenant di prova in `<cwd>/data`, cioè nei dati di chi lancia.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DA_INVENT_DATA_DIR?.trim()) {
  process.env.DA_INVENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "da-ipam-test-dati-"));
}
