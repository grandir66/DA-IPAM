// Le due tabelle delle catene vecchie, con la definizione che avevano in
// `TENANT_SCHEMA_SQL` fino alla 2g (tappa 2 credenziali, T27): da lì lo schema
// dei tenant nuovi non le crea più, ma i DB del cliente le hanno finché la
// pulizia (`scripts/credenziali/pulizia-t2.ts`) non le toglie, e i bundle
// esportati prima della 2g le portano. Le prove che le riempiono le creano con
// questa definizione, copiata com'era (vincolo «una prova sul DB con lo schema
// vero»: la definizione vecchia completa, per le migrazioni).
import type Database from "better-sqlite3";

export const DDL_CATENE_VECCHIE = `
CREATE TABLE IF NOT EXISTS network_host_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(network_id, credential_id, role)
);

CREATE TABLE IF NOT EXISTS host_detect_credential (
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('windows', 'linux', 'ssh', 'snmp')),
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (host_id, role)
);

CREATE INDEX IF NOT EXISTS idx_network_host_credentials_net_role ON network_host_credentials(network_id, role);
`;

/** Crea le due tabelle vecchie (con l'indice) se mancano. */
export function creaCateneVecchie(db: Database.Database): void {
  db.exec(DDL_CATENE_VECCHIE);
}
