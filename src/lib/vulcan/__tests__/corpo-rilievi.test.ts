// Invio dei rilievi delle Scansioni interne a DA-Vul-can (Riccardo, 11/11/2026).
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { DDL_VULCAN, TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { accoda } from "../coda";
import { corpoRilievi, leggiRetePassiva, type RilievoInterno } from "../corpo-rilievi";

const R: RilievoInterno = {
  chiave: "giro:telnet:7:23", tipo: "telnet", gravita: "High", titolo: "Telnet aperto su 10.0.0.7:23", prova: "Porta 23 aperta.", rimedio: "Spegni telnet.",
  ip: "10.0.0.7", hostname: "sw-1", rete_cidr: "10.0.0.0/24", porta: 23, protocollo: "tcp", visto: "2026-11-11 10:00:00",
};
const TESTA = { codcli: "00001", nodo: "prova", versione: "0.9.0", adesso: new Date("2026-11-11T12:00:00Z") };

test("corpo dei rilievi: solo i campi dichiarati, ordinati per chiave", () => {
  const c = corpoRilievi({ rilievi: [{ ...R, chiave: "giro:z:1:1", tipo: "z" }, R], parziale: false }, TESTA);
  assert.ok("json" in c);
  const o = JSON.parse(c.json) as { rilievi: Array<Record<string, unknown>>; schema_versione: number; fonte: string };
  assert.equal(o.schema_versione, 1);
  assert.equal(o.fonte, "scansioni-interne");
  assert.deepEqual(o.rilievi.map((r) => r.chiave), ["giro:telnet:7:23", "giro:z:1:1"]);
  assert.deepEqual(Object.keys(o.rilievi[0]).sort(), ["chiave", "gravita", "hostname", "ip", "porta", "protocollo", "prova", "rete_cidr", "rimedio", "tipo", "titolo", "visto"]);
});

test("login di fabbrica: il nome dell'utente non esce (Riccardo, 11/11/2026)", () => {
  const c = corpoRilievi({ rilievi: [{ ...R, chiave: "giro:login-fabbrica:7:80", tipo: "login-fabbrica", prova: "Accettato l'utente «admin»." }], parziale: false }, TESTA);
  assert.ok("json" in c);
  assert.ok(!c.json.includes("admin"));
  assert.ok(c.json.includes("Le credenziali di fabbrica danno accesso."));
  const i = corpoRilievi({ rilievi: [{ ...R, chiave: "giro:ipmi-rakp:7:623:udp", tipo: "ipmi-rakp", titolo: "IPMI RAKP utente admin su 10.0.0.7:623", prova: "RAKP Message 2 con status 0 per l'utente admin: HMAC recuperabile." }], parziale: false }, TESTA);
  assert.ok("json" in i && !i.json.includes("admin"));
});

test("lettura passiva: solo conteggi, niente MAC né indirizzi; senza sensore il campo non parte", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  assert.equal(leggiRetePassiva(db), null);
  db.prepare("INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, protocolli, prima_vista, ultima_vista) VALUES (1, 'aabbccddeeff', 'AA:BB:CC:DD:EE:FF', '10.1.2.3', 'arp,llmnr', datetime('now'), datetime('now'))").run();
  db.prepare("INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, protocolli, prima_vista, ultima_vista) VALUES (1, '112233445566', '11:22:33:44:55:66', '10.1.2.4', 'arp', datetime('now'), datetime('now'))").run();
  db.prepare("INSERT INTO rete_rilievi (chiave, tipo, categoria, gravita, mac, ip, descrizione, rilevato_il, aggiornato_il) VALUES ('k1', 'ip_conteso', 'allarme', 'media', 'AA:BB:CC:DD:EE:FF', '10.1.2.3', 'x', datetime('now'), datetime('now'))").run();
  const p = leggiRetePassiva(db);
  assert.ok(p);
  assert.equal(p.dispositivi, 2);
  assert.deepEqual(p.protocolli, [{ nome: "arp", dispositivi: 2 }, { nome: "llmnr", dispositivi: 1 }]);
  assert.deepEqual(p.rilievi, [{ tipo: "ip_conteso", categoria: "allarme", gravita: "media", quanti: 1 }]);
  const c = corpoRilievi({ rilievi: [R], parziale: false, passiva: p }, TESTA);
  assert.ok("json" in c && c.json.includes('"rete_passiva"'));
  assert.ok(!/10\.1\.2\.|AA:BB|aabbcc/i.test(c.json));
});

test("la coda nata prima dell'11/11 accetta «rilievi» dopo la migrazione e tiene le sue righe", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.exec(DDL_VULCAN.find(([n]) => n === "vulcan_coda")![1].replace(", 'rilievi'", ""));
  db.prepare("INSERT INTO vulcan_coda (tipo, corpo_gz, byte_json, sha256) VALUES ('inventario', x'00', 1, 'abc')").run();
  assert.throws(() => db.prepare("INSERT INTO vulcan_coda (tipo, corpo_gz, byte_json, sha256) VALUES ('rilievi', x'00', 1, 'def')").run());
  assert.ok(migrateVulcanCoda(db).includes("vulcan_coda:rilievi"));
  assert.deepEqual(migrateVulcanCoda(db), []);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM vulcan_coda WHERE sha256 = 'abc'").get() as { n: number }).n, 1);
  const primo = accoda(db, { tipo: "rilievi", rif: null, json: "{\"a\":1}", oggetti: 1 });
  const secondo = accoda(db, { tipo: "rilievi", rif: null, json: "{\"a\":2}", oggetti: 1 });
  assert.ok(primo.nuovo && secondo.nuovo);
  assert.equal((db.prepare("SELECT stato FROM vulcan_coda WHERE id = ?").get(primo.id) as { stato: string }).stato, "superato");
});
