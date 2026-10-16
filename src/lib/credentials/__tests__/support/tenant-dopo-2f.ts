// Un DB tenant come quello dell'hub dopo il rilascio della 2f (tappa 2
// credenziali), per le prove della pulizia (T27): un apparato lasciato dalla 2e
// nella forma accettata da Riccardo il 16/10 (voce nella colonna e binding
// fallito verso la stessa voce), un controller con la voce e uno senza, un AD
// con la voce, catene vecchie piene. Schema di oggi più le tabelle vecchie,
// come le ha un DB di prima della pulizia. Nomi finti, nessun dato vero.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { encrypt } from "@/lib/crypto";
import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { creaCateneVecchie } from "@/lib/__tests__/support/catene-vecchie";

export const DATA_2F = "2026-10-16T08:00:00.000Z";

export interface TenantDopo2f {
  d: Database.Database;
  file: string;
  lasciato: number;
  ctrlVoce: number;
  ctrlSenza: number;
  adVoce: number;
}

/** Crea il DB in `file` (la cartella si crea). Il DB resta aperto: chi lo vuole chiuso chiama `d.close()`. */
export function creaTenantDopo2f(file: string): TenantDopo2f {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  creaCateneVecchie(d);
  try { d.exec("ALTER TABLE network_devices ADD COLUMN host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL"); } catch { /* già presente */ }
  const segno = d.prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)");
  segno.run("credenziali_t2_tipi", `done:${DATA_2F}:x=0`);
  segno.run("credenziali_t2_catene", `done:${DATA_2F}:x=0`);
  segno.run("credenziali_t2_apparati", `parziale:${DATA_2F}:lasciati=1`);
  segno.run("credenziali_t2_integrazioni", `done:${DATA_2F}:x=0`);
  const voce = (nome: string, tipo: string, utente: string | null, segreto: string, metodo: string | null = null) =>
    Number(
      d.prepare("INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)")
        .run(nome, tipo, metodo, utente == null ? null : encrypt(utente), encrypt(segreto)).lastInsertRowid,
    );
  const vL = voce("Server lasciato · SSH", "ssh", "root", "pw-root");
  const lasciato = Number(
    d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Server lasciato', '10.91.0.2', 'server', 'linux', 'ssh', 22, ?)")
      .run(vL).lastInsertRowid,
  );
  d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', 22, 0, 'failed')").run(lasciato, vL);
  const vC = voce("UniFi · Sede", "unifi", null, "chiave-sede", "chiave");
  const ctrlVoce = Number(
    d.prepare("INSERT INTO network_controllers (name, vendor, kind, url, username, password_enc, api_key_enc, credential_id) VALUES ('Sede', 'unifi', 'udm', 'https://10.91.0.10', '', '', ?, ?)")
      .run(encrypt("chiave-sede"), vC).lastInsertRowid,
  );
  const ctrlSenza = Number(
    d.prepare("INSERT INTO network_controllers (name, vendor, kind, url, username, password_enc) VALUES ('Magazzino', 'unifi', 'self_hosted', 'https://10.91.0.11', 'admin', ?)")
      .run(encrypt("pw-magazzino")).lastInsertRowid,
  );
  const vA = voce("AD · Dominio", "ad", "svc-ldap", "pw-ldap");
  const adVoce = Number(
    d.prepare("INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, credential_id) VALUES ('Dominio', 'dc1.prova.local', 'prova.local', 'DC=prova,DC=local', ?, ?, ?)")
      .run(encrypt("svc-ldap"), encrypt("pw-ldap"), vA).lastInsertRowid,
  );
  const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.91.0.0/24', 'Rete prova')").run().lastInsertRowid);
  const host = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.91.0.5')").run(rete).lastInsertRowid);
  d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'ssh', 0)").run(rete, vL);
  d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'ssh', ?)").run(host, vL);
  return { d, file, lasciato, ctrlVoce, ctrlSenza, adVoce };
}

/** Tutto il contenuto del DB, tabella per tabella: per dire «non è cambiato niente». */
export function contenutoDb(d: Database.Database): string {
  const tabelle = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  return JSON.stringify(tabelle.map((t) => [t, d.prepare(`SELECT * FROM "${t}"`).all()]));
}
