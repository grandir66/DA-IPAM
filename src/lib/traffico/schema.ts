/**
 * Traffico dal collector (20/11/2026): tabelle nel database del tenant, solo additive.
 * Nessun CHECK e nessuna chiave esterna verso `hosts`: le coppie restano per IP anche se
 * l'host viene tolto. Spec: docs/superpowers/specs/2026-11-20-collector-traffico-design.md
 */
import type Database from "better-sqlite3";

const pronte = new WeakSet<Database.Database>();

export function assicuraTabelleTraffico(db: Database.Database): void {
  if (pronte.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS traffico_collector (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, sede TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL, gettone_enc TEXT NOT NULL, impronta TEXT NOT NULL, attivo INTEGER NOT NULL DEFAULT 1,
      cursore_coppie INTEGER NOT NULL DEFAULT 0, cursore_fatti INTEGER NOT NULL DEFAULT 0,
      ultimo_contatto TEXT, ultimo_errore TEXT, ultimo_buco TEXT, copertura REAL, creato TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traffico_coppie (
      giorno TEXT NOT NULL, collector_id INTEGER NOT NULL, client TEXT NOT NULL, server TEXT NOT NULL,
      proto INTEGER NOT NULL, porta INTEGER NOT NULL, byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL,
      flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
      PRIMARY KEY (giorno, collector_id, client, server, proto, porta));
    CREATE INDEX IF NOT EXISTS idx_traffico_coppie_client ON traffico_coppie (client, giorno);
    CREATE INDEX IF NOT EXISTS idx_traffico_coppie_server ON traffico_coppie (server, giorno);
    CREATE TABLE IF NOT EXISTS traffico_abitudini (
      client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
      prima_vista TEXT NOT NULL, confermata INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client, server, proto, porta));
    CREATE INDEX IF NOT EXISTS idx_traffico_abitudini_server ON traffico_abitudini (server);
    CREATE TABLE IF NOT EXISTS traffico_reti (network_id INTEGER PRIMARY KEY, prima_vista TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traffico_anomalie (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, gravita INTEGER NOT NULL,
      client TEXT NOT NULL, server TEXT NOT NULL DEFAULT '', proto INTEGER NOT NULL DEFAULT 0, porta INTEGER NOT NULL DEFAULT 0,
      dettaglio TEXT NOT NULL DEFAULT '{}', prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
      conteggio INTEGER NOT NULL DEFAULT 1, stato TEXT NOT NULL DEFAULT 'nuova',
      UNIQUE (tipo, client, server, proto, porta));
    CREATE INDEX IF NOT EXISTS idx_traffico_anomalie_stato ON traffico_anomalie (stato, ultima_vista);
  `);
  pronte.add(db);
}
