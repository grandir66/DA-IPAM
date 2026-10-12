/**
 * Hub isolato per le prove sugli utenti: si importa PER PRIMO, prima di
 * qualunque modulo che carichi `db-hub`.
 *
 * Perché un modulo a parte: gli `import` si eseguono prima del corpo del file
 * di prova, e `db-hub` fissa il percorso del database quando si carica.
 * Impostare `DA_IPAM_HUB_DB_PATH` nel corpo della prova arriverebbe tardi: la
 * prova aprirebbe `data/hub.db` (o quello di `DA_INVENT_DATA_DIR`) e il suo
 * `DELETE FROM users` cancellerebbe gli utenti veri. Visto il 12/10: l'hub
 * della prova finiva nella cartella dati, non in quella temporanea.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const TEST_HUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "da-ipam-test-users-"));
export const TEST_HUB_PATH = path.join(TEST_HUB_DIR, "hub.db");

process.env.DA_IPAM_HUB_DB_PATH = TEST_HUB_PATH;
process.env.ENCRYPTION_KEY ||= "test-encryption-key-users-svc01";
