/**
 * Traffico dal collector (20/11/2026): tabelle nel database del tenant, solo additive.
 * Nessun CHECK e nessuna chiave esterna verso `hosts`: le coppie restano per IP anche se
 * l'host viene tolto. `traffico_ore` (23/11) è la stessa coppia per ora invece che per giorno,
 * tenuta 7 giorni: serve a «Ultima ora» e all'andamento; la chiave comincia dall'ora e dalla coppia
 * perché il massimo fra collector si legge senza riordinare. Spec: docs/superpowers/specs/2026-11-20-collector-traffico-design.md
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
      giorno TEXT NOT NULL, collector_id INTEGER NOT NULL, fonte TEXT NOT NULL DEFAULT 'mirror', client TEXT NOT NULL, server TEXT NOT NULL,
      proto INTEGER NOT NULL, porta INTEGER NOT NULL, byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL,
      flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
      PRIMARY KEY (giorno, collector_id, fonte, client, server, proto, porta));
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
    CREATE TABLE IF NOT EXISTS traffico_controlli (
      network_id INTEGER NOT NULL, tipo TEXT NOT NULL, acceso INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (network_id, tipo));
    CREATE TABLE IF NOT EXISTS traffico_nomi (
      giorno TEXT NOT NULL, client TEXT NOT NULL, tipo TEXT NOT NULL, nome TEXT NOT NULL,
      conteggio INTEGER NOT NULL, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
      PRIMARY KEY (giorno, client, tipo, nome));
    CREATE TABLE IF NOT EXISTS traffico_identita (
      collector_id INTEGER NOT NULL, mac TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', fonte TEXT NOT NULL,
      vlan INTEGER NOT NULL DEFAULT 0, nome TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '',
      prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
      PRIMARY KEY (collector_id, mac, ip, fonte)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_traffico_identita_ip ON traffico_identita (ip, fonte);
    CREATE INDEX IF NOT EXISTS idx_traffico_identita_mac ON traffico_identita (mac);
    CREATE TABLE IF NOT EXISTS traffico_ore (
      ora TEXT NOT NULL, client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,
      collector_id INTEGER NOT NULL, fonte TEXT NOT NULL DEFAULT 'mirror',
      byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ora, client, server, proto, porta, collector_id, fonte)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_traffico_ore_client ON traffico_ore (client, ora);
    CREATE INDEX IF NOT EXISTS idx_traffico_ore_server ON traffico_ore (server, ora);
  `);
  // `fonte` (mirror, netflow, sflow) fa parte della chiave: i flussi campionati di un apparato non si
  // sommano al mirror dello stesso tratto. La chiave primaria non si altera: la tabella nata senza
  // `fonte` (20/11, prima di NetFlow e sFlow) si ricostruisce una volta, con le righe che ha.
  if (!(db.prepare("PRAGMA table_info(traffico_coppie)").all() as { name: string }[]).some((c) => c.name === "fonte")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE traffico_coppie_v2 (
          giorno TEXT NOT NULL, collector_id INTEGER NOT NULL, fonte TEXT NOT NULL DEFAULT 'mirror', client TEXT NOT NULL, server TEXT NOT NULL,
          proto INTEGER NOT NULL, porta INTEGER NOT NULL, byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL,
          flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0, prima_vista TEXT NOT NULL, ultima_vista TEXT NOT NULL,
          PRIMARY KEY (giorno, collector_id, fonte, client, server, proto, porta));
        INSERT INTO traffico_coppie_v2 (giorno, collector_id, fonte, client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista)
          SELECT giorno, collector_id, 'mirror', client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista FROM traffico_coppie;
        DROP TABLE traffico_coppie;
        ALTER TABLE traffico_coppie_v2 RENAME TO traffico_coppie;
      `);
    })();
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traffico_coppie_client ON traffico_coppie (client, giorno);
    CREATE INDEX IF NOT EXISTS idx_traffico_coppie_server ON traffico_coppie (server, giorno);
  `);
  // Colonna aggiunta dopo la prima stesura della tabella: ALTER idempotente.
  const colonne = (db.prepare("PRAGMA table_info(traffico_collector)").all() as { name: string }[]).map((c) => c.name);
  if (!colonne.includes("cursore_nomi")) db.exec("ALTER TABLE traffico_collector ADD COLUMN cursore_nomi INTEGER NOT NULL DEFAULT 0");
  if (!colonne.includes("cursore_identita")) db.exec("ALTER TABLE traffico_collector ADD COLUMN cursore_identita INTEGER NOT NULL DEFAULT 0");
  pronte.add(db);
}
