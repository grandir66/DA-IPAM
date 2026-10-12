// Misura del DB tenant (tappa 3, T3-01; strumento per DB-1, DB-2, DB-3).
//
// La misura si usa prima e dopo ogni intervento sul database: deve dare numeri
// giusti, non scrivere niente e non far uscire dati del cliente. Il DB finto ha
// la forma vera: schema di TENANT_SCHEMA_SQL, MAC sia nella forma `AA:BB:…` sia
// a 12 cifre, date con lo spazio nelle tabelle storiche e con `T…Z` in
// mac_ip_mapping, un MAC che va e torna fra due IP sei volte.
//
// Non importa db-tenant né l'hub: il modulo lavora su una connessione passata.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { apriInSolaLettura, misuraDbTenant, tabellaLeggibile } from "@/lib/db-maintenance/misura";

const dir = mkdtempSync(path.join(tmpdir(), "misura-db-"));
const FILE = path.join(dir, "tenant.db");
after(() => rmSync(dir, { recursive: true, force: true }));

// Valori seminati che NON devono comparire nell'output.
const MAC_SEGRETO = "DE:AD:BE:EF:42:17";
const MAC_SEGRETO_12 = "deadbeef4217";
const IP_A = "10.77.66.55";
const IP_B = "10.77.66.56";
const ADESSO = "2026-10-12 12:00:00";

function giorniFa(n: number, ora = "08:00:00"): string {
  const d = new Date(Date.parse(`${ADESSO.replace(" ", "T")}Z`) - n * 86_400_000);
  return `${d.toISOString().slice(0, 10)} ${ora}`;
}

function costruisci(): void {
  const db = new Database(FILE);
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.77.66.0/24', 'Rete prova'), (2, '10.88.0.0/24', 'Rete due')").run();
  const host = db.prepare("INSERT INTO hosts (network_id, ip, mac, status) VALUES (?, ?, ?, ?)");
  host.run(1, IP_A, MAC_SEGRETO, "online");
  host.run(1, IP_B, MAC_SEGRETO, "offline"); // stesso MAC su due host
  host.run(1, "10.77.66.10", "00:11:22:33:44:55", "online");
  host.run(2, "10.88.0.4", null, "unknown");
  db.prepare(
    "INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'router', '10.77.66.1', 'router', 'mikrotik', 'ssh')",
  ).run();
  const arp = db.prepare("INSERT INTO arp_entries (device_id, mac, ip, timestamp) VALUES (1, ?, ?, ?)");
  arp.run(MAC_SEGRETO, IP_A, giorniFa(0));
  arp.run(MAC_SEGRETO, IP_B, giorniFa(0));
  arp.run("00:11:22:33:44:55", "10.77.66.10", giorniFa(0));

  // Storico MAC-IP: il MAC segreto va e torna fra A e B sei volte (12 righe, 2
  // coppie); un MAC a 12 cifre sempre sullo stesso IP (3 righe, 1 coppia).
  const storia = db.prepare("INSERT INTO mac_ip_history (mac_normalized, ip, source, changed_at) VALUES (?, ?, 'arp', ?)");
  for (let i = 0; i < 6; i++) {
    storia.run(MAC_SEGRETO_12, IP_A, giorniFa(200 - i * 2));
    storia.run(MAC_SEGRETO_12, IP_B, giorniFa(199 - i * 2));
  }
  storia.run("0011223344aa", "10.77.66.10", giorniFa(1));
  storia.run("0011223344aa", "10.77.66.10", giorniFa(1, "09:00:00"));
  storia.run("0011223344aa", "10.77.66.10", giorniFa(0));

  // Mappa attuale con date `T…Z`: l'IP precedente aggiunge una coppia nuova.
  db.prepare(
    "INSERT INTO mac_ip_mapping (mac_normalized, mac_display, ip, previous_ip, source, first_seen, last_seen) VALUES (?, ?, ?, ?, 'arp', ?, ?)",
  ).run("0011223344aa", "00:11:22:33:44:AA", "10.77.66.10", "10.77.66.99", "2026-05-18T08:00:00.000Z", "2026-10-12T08:00:00.000Z");

  // scan_history: rete 1 fast recente e vecchia; rete 2 discovery vecchia di 100 giorni.
  const scan = db.prepare("INSERT INTO scan_history (network_id, scan_type, status, timestamp) VALUES (?, ?, 'completed', ?)");
  scan.run(1, "fast", giorniFa(95));
  scan.run(1, "fast", giorniFa(1));
  scan.run(2, "network_discovery", giorniFa(100));

  const stato = db.prepare("INSERT INTO status_history (host_id, status, checked_at) VALUES (1, 'online', ?)");
  for (const g of [10, 40, 100, 190]) stato.run(giorniFa(g));
  db.close();
}

const sha = (): string => createHash("sha256").update(readFileSync(FILE)).digest("hex");

test("misura: numeri giusti, file intatto, nessun MAC o IP nell'output", () => {
  costruisci();
  const prima = sha();
  const db = apriInSolaLettura(FILE);
  const m = misuraDbTenant(db, { adesso: ADESSO });
  const testo = tabellaLeggibile(m);
  db.close();
  assert.equal(sha(), prima, "il file del DB non deve cambiare");

  // Righe per tabella e spazio da dbstat.
  const righe = new Map(m.tabelle.map((t) => [t.tabella, t.righe]));
  assert.equal(righe.get("mac_ip_history"), 15);
  assert.equal(righe.get("hosts"), 4);
  assert.equal(righe.get("scan_history"), 3);
  assert.ok(m.spazio.disponibile, "dbstat deve esserci");
  assert.ok((m.tabelle.find((t) => t.tabella === "mac_ip_history")?.byte ?? 0) > 0);

  // mac_ip_history: coppie già viste e MAC con più IP.
  const h = m.mac_ip_history;
  assert.ok(h.presente);
  assert.equal(h.righe, 15);
  assert.equal(h.coppie_distinte, 3);
  assert.equal(h.righe_ripetute, 12);
  assert.equal(h.mac_con_piu_ip, 1);
  assert.equal(h.coppie_note_con_mappa, 4, "storico + IP attuale + IP precedente");
  assert.deepEqual(h.righe_al_giorno.slice(-2), [
    { giorno: giorniFa(1).slice(0, 10), righe: 2 },
    { giorno: giorniFa(0).slice(0, 10), righe: 1 },
  ]);
  assert.equal(m.mac_con_piu_ip_arp, 1);
  assert.deepEqual(m.mac_su_piu_host, { mac: 1, host: 2 });

  // Forme dei MAC per colonna.
  const forma = (tab: string, col: string) => m.forme_mac.find((f) => f.tabella === tab && f.colonna === col);
  assert.deepEqual(forma("hosts", "mac")?.forme, { due_punti_maiuscolo: 3 });
  assert.equal(forma("hosts", "mac")?.nulli, 1);
  assert.deepEqual(forma("mac_ip_history", "mac_normalized")?.forme, { cifre_12_minuscolo: 15 });
  assert.equal(forma("device_interfaces", "is_virtual_mac"), undefined, "un flag is_*_mac non è un MAC");

  // Forme delle date: spazio negli storici, T…Z nella mappa.
  const data = (tab: string, col: string) => m.forme_date.find((f) => f.tabella === tab && f.colonna === col);
  assert.deepEqual(data("mac_ip_history", "changed_at")?.forme, { spazio: 15 });
  assert.deepEqual(data("mac_ip_mapping", "first_seen")?.forme, { t_z: 1 });

  // Oltre 30/90/180 giorni.
  const vecchie = (tab: string) => m.oltre_giorni.find((o) => o.tabella === tab);
  assert.deepEqual(vecchie("status_history"), {
    tabella: "status_history", colonna: "checked_at", presente: true, totale: 4, oltre_30: 3, oltre_90: 2, oltre_180: 1, non_leggibili: 0,
  });
  assert.equal(vecchie("mac_ip_history")?.oltre_180, 12);

  // Ultima scansione per (rete, tipo).
  assert.deepEqual(m.scan_history_ultime, [
    { network_id: 1, scan_type: "fast", righe: 2, ultima: giorniFa(1), giorni: 1 },
    { network_id: 2, scan_type: "network_discovery", righe: 1, ultima: giorniFa(100), giorni: 100 },
  ]);

  // Nessun dato del cliente nell'output.
  const uscita = JSON.stringify(m) + testo;
  for (const segreto of [MAC_SEGRETO, MAC_SEGRETO_12, IP_A, IP_B, "10.77.66.0", "Rete prova", "deadbeef", "DE:AD"]) {
    assert.ok(!uscita.toLowerCase().includes(segreto.toLowerCase()), `l'output contiene un valore seminato: ${segreto}`);
  }
});

test("misura: senzaSpazio salta dbstat e lo dice", () => {
  const db = apriInSolaLettura(FILE);
  const m = misuraDbTenant(db, { adesso: ADESSO, senzaSpazio: true });
  db.close();
  assert.equal(m.spazio.disponibile, false);
  assert.equal(m.spazio.motivo, "saltato (--senza-spazio)");
  assert.ok(m.tabelle.every((t) => t.byte === null));
});

test("misura: rifiuta una connessione scrivibile e un file che non esiste", () => {
  const db = new Database(FILE);
  assert.throws(() => misuraDbTenant(db), /sola lettura/);
  db.close();
  assert.throws(() => apriInSolaLettura(path.join(dir, "manca.db")));
});

test("misura: una tabella assente si dice, non diventa zero", () => {
  const vuoto = path.join(dir, "vecchio.db");
  const w = new Database(vuoto);
  w.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY, mac TEXT)");
  w.close();
  const db = apriInSolaLettura(vuoto);
  const m = misuraDbTenant(db, { adesso: ADESSO, senzaSpazio: true });
  db.close();
  assert.equal(m.mac_ip_history.presente, false);
  assert.equal(m.oltre_giorni.find((o) => o.tabella === "scan_history")?.presente, false);
  assert.match(tabellaLeggibile(m), /mac_ip_history: assente/);
});
