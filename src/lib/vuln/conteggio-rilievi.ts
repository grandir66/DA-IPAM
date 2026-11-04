import type Database from "better-sqlite3";

/**
 * Riallinea `vuln_scan_runs.finding_count` a quello che abbiamo davvero in
 * archivio. Idempotente: ritorna quante righe ha corretto.
 *
 * Perche' esiste (04/11/2026): il numero arrivava dalla sonda e veniva scritto
 * cosi' com'e', senza mai essere ricalcolato dopo lo scarico dei rilievi. Ma il
 * `finding_count` della sonda conta **solo i rilievi Greenbone**: esclude quelli
 * `nuclei:` e `controllo:`, che pure la sonda restituisce dentro lo stesso scan.
 * Misurato sull'hub: giro 124 dichiarava 1832 e ne aveva 2402; 123, 122 e 121
 * lo stesso, col dichiarato esattamente pari al totale Greenbone. La colonna
 * non la leggeva nessuno, quindi non si vedeva da nessuna parte, ma era una
 * trappola per il primo che l'avesse presa per un totale.
 *
 * Il difetto a monte resta della sonda ed e' annotato nel TASKS di DA-Vul-can:
 * dove il numero si vede (pannello della subnet) lo chiediamo a lei al volo, e
 * questa correzione non lo tocca.
 *
 * **Solo i giri di cui abbiamo almeno un rilievo.** Un giro appena inserito, i
 * cui rilievi non sono ancora stati scaricati, conserva il numero della sonda:
 * azzerarlo sarebbe sostituire un dato impreciso con uno falso.
 */
export function riallineaConteggioRilievi(db: Database.Database, scannerId?: number): number {
  const quanti = "(SELECT COUNT(*) FROM vuln_findings f WHERE f.scan_run_id = vuln_scan_runs.id)";
  const filtroScanner = scannerId === undefined ? "" : "scanner_id = ? AND ";
  const sql = `UPDATE vuln_scan_runs
                  SET finding_count = ${quanti}
                WHERE ${filtroScanner}${quanti} > 0
                  AND COALESCE(finding_count, -1) <> ${quanti}`;
  const stmt = db.prepare(sql);
  return (scannerId === undefined ? stmt.run() : stmt.run(scannerId)).changes;
}
