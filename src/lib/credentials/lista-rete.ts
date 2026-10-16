/**
 * La lista unica delle credenziali di una rete (`network_credentials`),
 * scritta con il controllo del tipo (tappa 2 credenziali, T13, 16/10).
 *
 * Dalla 2c l'archivio ha voci UniFi, Omada e Active Directory, che non valgono
 * per nessun protocollo d'accesso: nella lista di una rete finirebbero nella
 * discovery, nella validazione e nell'anteprima edge (D7 = (a): l'account AD
 * mai nelle prove in sequenza). Prima la lista accettava qualunque voce.
 *
 * `replaceNetworkCredentials`, `addNetworkCredential` e
 * `copyNetworkCredentials` di `db.ts` e `db-tenant.ts` sono involucri di una
 * riga di queste funzioni. Un id che non esiste resta all'errore di chiave
 * esterna, come prima (la pagina della rete lo traduce già).
 *
 * Modulo con l'handle del DB esplicito: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { erroreVocePerRete } from "./tipi";

/** Una voce che non vale per la lista della rete: le rotte rispondono 400 col messaggio. */
export class CredenzialeNonAmmessa extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "CredenzialeNonAmmessa";
  }
}

/** Lancia `CredenzialeNonAmmessa` per la prima voce esistente che non vale per una rete. */
function controllaVoci(dbh: Database.Database, ids: readonly number[]): void {
  if (ids.length === 0) return;
  const voci = dbh
    .prepare(`SELECT id, name, credential_type FROM credentials WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .all(...ids) as Array<{ id: number; name: string; credential_type: string }>;
  const perId = new Map(voci.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = perId.get(id);
    if (!v) continue;
    const errore = erroreVocePerRete(v);
    if (errore) throw new CredenzialeNonAmmessa(errore);
  }
}

function senzaDoppi(ids: readonly number[]): number[] {
  return [...new Set(ids)];
}

/** Sostituisce la lista della rete (ordine = posizione), tutto o niente. */
export function sostituisciListaReteDb(dbh: Database.Database, networkId: number, credentialIds: readonly number[]): void {
  const unici = senzaDoppi(credentialIds);
  controllaVoci(dbh, unici);
  dbh.transaction(() => {
    dbh.prepare(`DELETE FROM network_credentials WHERE network_id = ?`).run(networkId);
    const ins = dbh.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`);
    unici.forEach((cid, i) => ins.run(networkId, cid, i));
  })();
}

/** Aggiunge una voce in coda alla lista della rete (una voce già presente resta dov'è). */
export function aggiungiAllaListaReteDb(dbh: Database.Database, networkId: number, credentialId: number): void {
  controllaVoci(dbh, [credentialId]);
  const max = dbh
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`)
    .get(networkId) as { m: number };
  dbh
    .prepare(`INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`)
    .run(networkId, credentialId, max.m + 1);
}

/** Copia in coda le voci di un'altra rete che mancano; restituisce quante ne ha aggiunte. */
export function copiaListaReteDb(dbh: Database.Database, sourceNetworkId: number, targetNetworkId: number): number {
  const sorgente = (
    dbh
      .prepare(
        `SELECT nc.credential_id FROM network_credentials nc JOIN credentials c ON c.id = nc.credential_id
         WHERE nc.network_id = ? ORDER BY nc.sort_order ASC, nc.id ASC`,
      )
      .all(sourceNetworkId) as Array<{ credential_id: number }>
  ).map((r) => r.credential_id);
  const presenti = new Set(
    (dbh.prepare(`SELECT credential_id FROM network_credentials WHERE network_id = ?`).all(targetNetworkId) as Array<{ credential_id: number }>).map(
      (r) => r.credential_id,
    ),
  );
  const daCopiare = sorgente.filter((id) => !presenti.has(id));
  controllaVoci(dbh, daCopiare);
  const max = dbh
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`)
    .get(targetNetworkId) as { m: number };
  let ordine = max.m + 1;
  const ins = dbh.prepare(`INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`);
  let aggiunte = 0;
  dbh.transaction(() => {
    for (const id of daCopiare) {
      ins.run(targetNetworkId, id, ordine++);
      aggiunte++;
    }
  })();
  return aggiunte;
}
