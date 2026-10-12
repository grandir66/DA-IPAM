// Hub DB di prova, uno per processo: un file di test lo importa PER PRIMO,
// prima di qualunque modulo che tocchi db-hub.
//
// Perché un modulo a parte (12/10, misurato): gli `import` di un file vengono
// valutati prima del suo corpo, anche sotto tsx. Un'assegnazione a
// `process.env.DA_IPAM_HUB_DB_PATH` scritta in testa al file di test arriva
// quindi tardi: db-hub ha già fissato `HUB_DB_PATH` sul percorso predefinito,
// `DA_INVENT_DATA_DIR/hub.db`. Quello è condiviso fra i file di prova che girano
// in parallelo (due file con chiavi di cifratura diverse si leggevano i segreti
// a vicenda: «Decifrazione fallita») e, senza DA_INVENT_DATA_DIR, è il vero hub.
// Un modulo importato per primo invece viene valutato prima degli altri.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-hub-isolato1";

export const TEST_HUB_DB_PATH = path.join(
  os.tmpdir(),
  `da-ipam-test-hub-${process.pid}-${Math.random().toString(36).slice(2, 10)}.db`,
);
process.env.DA_IPAM_HUB_DB_PATH = TEST_HUB_DB_PATH;

/** Cancella i file dell'hub di prova; da chiamare dopo `closeHubDb()`. */
export function removeTestHubDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(TEST_HUB_DB_PATH + suffix, { force: true });
    } catch {
      /* ignore */
    }
  }
}
