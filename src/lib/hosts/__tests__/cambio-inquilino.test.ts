/**
 * Cambio di inquilino su un indirizzo (11/11/2026, hub 533: il telefono che prende l'indirizzo di una stampante
 * Kyocera ne teneva dati SNMP, produttore e porte, e risultava «stampante» con confidenza 90).
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/cambio-inquilino.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  cambioInquilinoSeServe, eCambioDiInquilino, impostaCambioInquilino, macPrivato, macVirtuale, nomePersonale, righeEreditate, svuotaInquilino,
} from "../cambio-inquilino";

let db: Database.Database;
const STAMPANTE = "00:C0:EE:11:22:33";
const TELEFONO = "4A:08:63:EA:11:AF";

function riga(id: number, mac: string | null, extra: Record<string, unknown> = {}) {
  const dati: Record<string, unknown> = {
    id, network_id: 1, ip: `10.0.0.${id}`, mac, vendor: "Kyocera", hostname: "KM-UFFICIO", hostname_source: "snmp",
    os_info: "KYOCERA Printing System", snmp_data: '{"sysDescr":"KYOCERA"}', open_ports: "[{\"port\":9100}]",
    classification: "stampante", classification_manual: 0, notes: "piano 2", ...extra,
  };
  const col = Object.keys(dati);
  db.prepare(`INSERT INTO hosts (${col.join(",")}) VALUES (${col.map(() => "?").join(",")})`).run(...col.map((c) => dati[c]));
}
function leggi(id: number) {
  return db.prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Record<string, unknown>;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, ip TEXT, mac TEXT, vendor TEXT, hostname TEXT,
      hostname_source TEXT, custom_name TEXT, os_info TEXT, model TEXT, serial_number TEXT, firmware TEXT, device_manufacturer TEXT,
      detection_json TEXT, snmp_data TEXT, open_ports TEXT, classification TEXT, classification_manual INTEGER,
      classification_reason TEXT, classification_json TEXT, server_roles TEXT, notes TEXT, physical_device_id INTEGER,
      attr_category TEXT, updated_at TEXT);
    CREATE TABLE multihomed_links (id INTEGER PRIMARY KEY, group_id TEXT, host_id INTEGER);
    CREATE TABLE tenant_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE attribution_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER, source TEXT, phase TEXT, dimension TEXT,
      claim TEXT, confidence REAL, weight REAL, raw_value TEXT, observed_at TEXT, expires_at TEXT, superseded_by INTEGER);`);
});

describe("macPrivato / macVirtuale", () => {
  it("il secondo carattere 2, 6, A, E segna un MAC casuale", () => {
    for (const m of ["4A:08:63:EA:11:AF", "E6:28:E4:EB:E1:2F", "16:0C:C7:B9:9D:B2", "82-FA-6F-7D-6D-54"]) assert.equal(macPrivato(m), true, m);
    for (const m of ["00:C0:EE:11:22:33", "BC:24:11:00:00:01", "", null]) assert.equal(macPrivato(m), false, String(m));
  });
  it("VRRP e HSRP sono indirizzi condivisi", () => {
    assert.equal(macVirtuale("00:00:5E:00:01:0A"), true);
    assert.equal(macVirtuale("00:00:0C:07:AC:01"), true);
    assert.equal(macVirtuale(STAMPANTE), false);
  });
});

describe("eCambioDiInquilino", () => {
  it("MAC diverso, nome diverso → è un altro apparato", () => {
    riga(1, STAMPANTE);
    assert.deepEqual(eCambioDiInquilino(db, 1, TELEFONO, "S25-Ultra-di-riccardo"), { cambio: true });
  });
  it("stesso MAC, o un MAC che manca → no", () => {
    riga(1, STAMPANTE); riga(2, null);
    assert.deepEqual(eCambioDiInquilino(db, 1, "00-c0-ee-11-22-33"), { cambio: false, motivo: "stesso_mac" });
    assert.deepEqual(eCambioDiInquilino(db, 2, TELEFONO), { cambio: false, motivo: "manca_un_mac" });
    assert.deepEqual(eCambioDiInquilino(db, 1, null), { cambio: false, motivo: "manca_un_mac" });
  });
  it("stesso nome DHCP con un MAC nuovo → lo stesso telefono che ha cambiato MAC casuale", () => {
    riga(1, "E6:28:E4:EB:E1:2F", { hostname: "S25-Ultra-di-riccardo" });
    assert.deepEqual(eCambioDiInquilino(db, 1, TELEFONO, "s25-ultra-di-riccardo"), { cambio: false, motivo: "stesso_nome" });
  });
  it("MAC su troppe righe (un router che risponde per altri) → no", () => {
    riga(1, STAMPANTE);
    for (let i = 2; i <= 6; i++) riga(i, "AA:BB:CC:00:00:01".replace("AA", "00"));
    assert.deepEqual(eCambioDiInquilino(db, 1, "00:BB:CC:00:00:01"), { cambio: false, motivo: "mac_su_molte_righe" });
  });
  it("il MAC di un'altra riga dello stesso apparato (gruppo o apparato fisico) → no", () => {
    riga(1, STAMPANTE, { physical_device_id: 7 }); riga(2, "00:C0:EE:11:22:34", { physical_device_id: 7 });
    assert.deepEqual(eCambioDiInquilino(db, 1, "00:C0:EE:11:22:34"), { cambio: false, motivo: "altro_indirizzo_dello_stesso_apparato" });
    riga(3, "00:11:22:33:44:55"); riga(4, "00:11:22:33:44:56");
    db.exec("INSERT INTO multihomed_links (group_id, host_id) VALUES ('g', 3), ('g', 4)");
    assert.deepEqual(eCambioDiInquilino(db, 3, "00:11:22:33:44:56"), { cambio: false, motivo: "altro_indirizzo_dello_stesso_apparato" });
  });
  it("MAC virtuale → no", () => {
    riga(1, STAMPANTE);
    assert.deepEqual(eCambioDiInquilino(db, 1, "00:00:5E:00:01:0A"), { cambio: false, motivo: "mac_virtuale" });
  });
});

describe("svuotaInquilino", () => {
  it("svuota i dati dell'apparato di prima e ritira le evidenze non manuali; le note restano", () => {
    riga(1, STAMPANTE);
    db.exec(`INSERT INTO attribution_evidence (host_id, source, phase, dimension, claim, confidence, weight) VALUES
      (1, 'snmp_sysobj', 'snmp', 'category', 'peripheral.printer', 0.95, 1), (1, 'manual', 'manual', 'vendor', 'kyocera', 1, 1)`);
    svuotaInquilino(db, 1, { nowIso: "2026-11-11T10:00:00.000Z" });
    const r = leggi(1);
    for (const c of ["vendor", "os_info", "snmp_data", "open_ports", "hostname", "hostname_source", "classification"]) assert.equal(r[c], null, c);
    assert.equal(r.notes, "piano 2");
    assert.equal(r.mac, STAMPANTE);
    const ev = db.prepare("SELECT source, expires_at FROM attribution_evidence ORDER BY id").all() as Array<{ source: string; expires_at: string | null }>;
    assert.equal(ev[0].expires_at, "2026-11-11T10:00:00.000Z");
    assert.equal(ev[1].expires_at, null);
  });
  it("la classe scelta a mano e il nome dato a mano restano", () => {
    riga(1, STAMPANTE, { classification: "smartphone", classification_manual: 1, hostname: "telefono-di-riccardo", hostname_source: "manual" });
    svuotaInquilino(db, 1);
    const r = leggi(1);
    assert.equal(r.classification, "smartphone");
    assert.equal(r.hostname, "telefono-di-riccardo");
    assert.equal(r.snmp_data, null);
  });
});

describe("svuotaInquilino con tieniNome (bonifica delle righe già sporche)", () => {
  it("il nome è dell'apparato di adesso e resta; i dati di quello di prima vanno via", () => {
    riga(1, TELEFONO, { hostname: "iPhone", hostname_source: "dhcp" });
    svuotaInquilino(db, 1, { tieniNome: true });
    const r = leggi(1);
    assert.equal(r.hostname, "iPhone");
    assert.equal(r.hostname_source, "dhcp");
    assert.equal(r.vendor, null);
    assert.equal(r.snmp_data, null);
  });
});

describe("cambioInquilinoSeServe", () => {
  it("spento di serie: non tocca niente", () => {
    riga(1, STAMPANTE);
    assert.equal(cambioInquilinoSeServe(db, 1, TELEFONO, "S25"), false);
    assert.equal(leggi(1).vendor, "Kyocera");
  });
  it("acceso: svuota solo quando è un altro apparato", () => {
    impostaCambioInquilino(db, true);
    riga(1, STAMPANTE); riga(2, STAMPANTE.replace("33", "44"));
    assert.equal(cambioInquilinoSeServe(db, 1, TELEFONO, "S25"), true);
    assert.equal(leggi(1).vendor, null);
    assert.equal(cambioInquilinoSeServe(db, 2, "00:C0:EE:11:22:44"), false);
    assert.equal(leggi(2).vendor, "Kyocera");
  });
});

describe("righeEreditate", () => {
  it("MAC casuale con dati altrui: sicura solo se il nome è di un apparato personale", () => {
    riga(1, TELEFONO, { hostname: "iPhone", hostname_source: "dhcp" });
    riga(2, STAMPANTE);
    riga(3, "E6:28:E4:EB:E1:2F", { vendor: null, snmp_data: null });
    riga(4, "26:5E:96:55:C9:A2", { hostname: "DA-ADRA" });
    const trovate = righeEreditate(db);
    assert.deepEqual(trovate.map((r) => [r.id, r.sicura, r.perche]), [[1, true, "nome_personale"], [4, false, "nome_non_personale"]]);
  });
  it("un MAC casuale su troppe righe non è mai sicuro, nemmeno col nome di un telefono", () => {
    for (let i = 1; i <= 5; i++) riga(i, "82:FA:6F:7D:6D:54", { hostname: "iPhone" });
    assert.ok(righeEreditate(db).every((r) => !r.sicura && r.perche === "mac_su_molte_righe"));
  });
  it("nomi personali riconosciuti, anche col dominio; gli altri no", () => {
    for (const n of ["iPhone", "iPad", "Watch", "Mac", "S25-Ultra-di-riccardo", "Fairphone-5-5G", "Galaxy-A54", "MacBook-Pro.domarc.it"]) assert.equal(nomePersonale(n), true, n);
    for (const n of ["DA-ADRA", "SynologyNAS", "DESKTOP-70KINTB", "NB-AGUZZOLI.domarc.it", "MikroTik", "Mac-Mini-Server", "", null]) assert.equal(nomePersonale(n), false, String(n));
  });
});
