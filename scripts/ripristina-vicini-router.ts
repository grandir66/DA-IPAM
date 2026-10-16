/**
 * ripristina-vicini-router.ts — stampa il testo SQL di «Tornare indietro» da T1 (spec topologia §13.11.1, R6), da mandare
 * all'impianto da stdin con sqlite3 via ssh, come le altre interrogazioni. Non apre nessun DB.
 *
 * Uso:  npx tsx scripts/ripristina-vicini-router.ts --dalle "AAAA-MM-GG HH:MM:SS" [--copia | --applica]
 *   (di base)  prova a vuoto: righe da riportare a `mndp`, per apparato e protocollo (niente nomi)
 *   --copia    le righe che si toccheranno, da salvare PRIMA: sqlite3 -readonly -cmd '.mode insert device_neighbors'
 *              (per rimetterle com'erano: lo stesso file con «INSERT OR REPLACE INTO» al posto di «INSERT INTO»)
 *   --applica  la scrittura, in una transazione; poi le righe che restano (atteso 0). Solo con la conferma di Riccardo.
 *              Con sqlite3 -bail -cmd '.timeout 5000': al primo errore si ferma, e la transazione aperta non si scrive.
 *   --dalle    l'ora del rilascio di T1, in UTC, come la scrive il DB.
 *   Uscita: 0 testo stampato, 2 non partito.
 */
import { sqlApplica, sqlConta, sqlCopia } from "../src/lib/topology/ripristino-vicini";

function main(): number {
  const a = process.argv.slice(2);
  const i = a.indexOf("--dalle");
  const dalle = i >= 0 ? a[i + 1] : undefined;
  if (!dalle || (a.includes("--copia") && a.includes("--applica"))) {
    process.stderr.write('Uso: npx tsx scripts/ripristina-vicini-router.ts --dalle "AAAA-MM-GG HH:MM:SS" [--copia | --applica]\n');
    return 2;
  }
  try {
    process.stdout.write(`${a.includes("--applica") ? sqlApplica(dalle) : a.includes("--copia") ? sqlCopia(dalle) : sqlConta(dalle)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

process.exit(main());
