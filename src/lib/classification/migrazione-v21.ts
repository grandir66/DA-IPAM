/**
 * Catalogo canonico (21/10): colonna `server_roles` e conversione una tantum delle
 * classificazioni doppie. Modulo puro: riceve l'handle (come credentials/segni-t2.ts),
 * non importa db.ts né db-tenant.ts.
 *
 * Il segno `classificazioni_v21` in `tenant_settings` (`done:<data>:<conteggi>`)
 * chiude la conversione: non si rifà. Senza segno o con `errore:` si riprova
 * all'apertura dopo. Sono escluse la storia (`host_classification_history`) e le
 * classificazioni personalizzate (`device_classifications_custom`).
 */
import type Database from "better-sqlite3";
import { canonicalizza, SLUG_VECCHI } from "./canonico";
import { aggiungiRuoloServer, impostaVendorSeVuoto } from "./scrittura";
import { conversioneChiusa, leggiSegno, scriviSegno } from "@/lib/credentials/segni-t2";

export const SEGNO_CLASSIFICAZIONI_V21 = "classificazioni_v21";

/** Aggiunge `server_roles` a hosts e network_devices se manca. Restituisce le colonne aggiunte. */
export function migrateServerRoles(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  db.transaction(() => {
    for (const table of ["hosts", "network_devices"]) {
      if (has(table, "server_roles")) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN server_roles TEXT`);
      added.push(`${table}.server_roles`);
    }
  })();
  return added;
}

export interface EsitoConversioneV21 {
  eseguita: boolean;
  hosts: number;
  apparati: number;
}

/** Converte gli slug vecchi di hosts e network_devices; idempotente grazie al segno. */
export function convertiClassificazioniV21(db: Database.Database): EsitoConversioneV21 {
  if (conversioneChiusa(leggiSegno(db, SEGNO_CLASSIFICAZIONI_V21))) return { eseguita: false, hosts: 0, apparati: 0 };
  const segnaposto = SLUG_VECCHI.map(() => "?").join(",");
  let hosts = 0;
  let apparati = 0;
  db.transaction(() => {
    const h = db.prepare(`SELECT id, classification FROM hosts WHERE classification IN (${segnaposto})`).all(...SLUG_VECCHI) as Array<{ id: number; classification: string }>;
    for (const r of h) {
      const c = canonicalizza(r.classification);
      db.prepare("UPDATE hosts SET classification = ? WHERE id = ?").run(c.classificazione, r.id);
      aggiungiRuoloServer(db, "hosts", r.id, c);
      hosts++;
    }
    const d = db.prepare(`SELECT id, classification FROM network_devices WHERE classification IN (${segnaposto})`).all(...SLUG_VECCHI) as Array<{ id: number; classification: string }>;
    for (const r of d) {
      const c = canonicalizza(r.classification);
      db.prepare("UPDATE network_devices SET classification = ? WHERE id = ?").run(c.classificazione, r.id);
      aggiungiRuoloServer(db, "network_devices", r.id, c);
      impostaVendorSeVuoto(db, r.id, c);
      apparati++;
    }
    scriviSegno(db, SEGNO_CLASSIFICAZIONI_V21, `done:${new Date().toISOString()}:hosts=${hosts},apparati=${apparati}`);
  })();
  return { eseguita: true, hosts, apparati };
}
