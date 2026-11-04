/**
 * Seriale e part number delle stampanti, regole OT sulle appliance (72729, 04/11/2026).
 *
 * Incidente 1: il profilo `hp_printer` leggeva come seriale `…11.2.3.9.1.1.7.0`, la stringa IEEE 1284 («MFG:HP;CMD:…»). Il seriale
 * vero (`prtGeneralSerialNumber`) rispondeva su 9 stampanti su 10, ma il finto non era vuoto e bloccava ogni ripiego. Epson e il
 * profilo generico leggevano `.16.1`, che è il nome: due ET-5805 avevano lo stesso «seriale», che è la chiave degli apparati fisici.
 * Incidente 2: le regole OT erano solo nel seed di `db.ts`; le appliance seminano da `db-hub.ts` e non le hanno mai avute.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/stampanti-seriale-detect.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { correggiOidProfiliStampanti } from "@/lib/db-hub";
import { eSerialeFinto } from "@/lib/devices/seriale-valido";
import { valoreCampoProfilo } from "@/lib/scanner/snmp-query";
import { resolveSnmpVendorProfile } from "@/lib/scanner/snmp-vendor-profiles";

const PRT_SERIALE = "1.3.6.1.2.1.43.5.1.1.17.1", PRT_NOME = "1.3.6.1.2.1.43.5.1.1.16.1", HR_DESCR = "1.3.6.1.2.1.25.3.2.1.3.1";
const HP_1284 = "1.3.6.1.4.1.11.2.3.9.1.1.7.0", HP_PART = "1.3.6.1.4.1.11.2.4.3.1.10.0";
const ID_HP = "MFG:HP;MDL:HP LaserJet Pro M428f-M429f;CMD:PCL5c,PCLXL,POSTSCRIPT,NATIVEOFFICE,PDF,PJL;CLS:PRINTER;";

describe("seriale finto", () => {
  it("la stringa IEEE 1284 non è un seriale", () => {
    assert.ok(eSerialeFinto(ID_HP));
    assert.ok(eSerialeFinto("MFG:HP;CMD:PJL,PCLXL,PCL,PDF,POSTSCRIPT;CID:HPLJPDLV1;"));
    assert.ok(eSerialeFinto("ID:ECOSYS MA5500ifx;MFG:Kyocera;CMD:PCLXL;"));
    assert.equal(valoreCampoProfilo("serial", ID_HP), null);
    assert.equal(valoreCampoProfilo("model", ID_HP), null);
  });

  it("il nome di una serie non è un seriale, ma resta un modello", () => {
    assert.ok(eSerialeFinto("ET-5805 Series"));
    assert.equal(valoreCampoProfilo("serial", "ET-5805 Series"), null);
    assert.equal(valoreCampoProfilo("model", "EPSON ET-5805 Series"), "EPSON ET-5805 Series");
  });

  it("i seriali veri passano, con le loro forme", () => {
    for (const s of ["CNAB123456", "XAAA000000", "WAA0000000", "S000X00000000"]) {
      assert.ok(!eSerialeFinto(s), s);
      assert.equal(valoreCampoProfilo("serial", s), s);
    }
    assert.ok(!eSerialeFinto(null));
    assert.ok(!eSerialeFinto(""));
  });
});

describe("profili SNMP delle stampanti", () => {
  it("HP: seriale dalla Printer-MIB, part number e modello preciso", () => {
    const p = resolveSnmpVendorProfile("1.3.6.1.4.1.11.2.3.9.1", "HP ETHERNET MULTI-ENVIRONMENT");
    assert.equal(p?.id, "hp_printer");
    assert.equal(p?.fields.serial, PRT_SERIALE);
    assert.equal(p?.fields.partNumber, HP_PART);
    assert.equal(p?.fields.model, HR_DESCR);
  });

  it("Epson: seriale .17, non il nome .16", () => {
    const f = resolveSnmpVendorProfile("1.3.6.1.4.1.1248.1.1.2.1.3.5.69.69.80.83.50", null)?.fields;
    assert.equal(f?.serial, PRT_SERIALE);
    assert.deepEqual(f?.model, [HR_DESCR, "1.3.6.1.2.1.47.1.1.1.1.13.1"]);
  });

  it("Kyocera ha un profilo: il sysDescr «Printing System» non prendeva quello generico", () => {
    const p = resolveSnmpVendorProfile("1.3.6.1.4.1.1347.41", "KYOCERA Document Solutions Printing System");
    assert.equal(p?.id, "kyocera");
    assert.equal(p?.category, "stampante");
    assert.equal(p?.fields.serial, PRT_SERIALE);
  });
});

describe("hub già installati", () => {
  const riga = (d: Database.Database, id: string) =>
    JSON.parse((d.prepare("SELECT fields FROM snmp_vendor_profiles WHERE profile_id = ?").get(id) as { fields: string }).fields) as Record<string, unknown>;
  const crea = () => {
    const d = new Database(":memory:");
    d.exec("CREATE TABLE snmp_vendor_profiles (profile_id TEXT, fields TEXT, builtin INTEGER, updated_at TEXT)");
    const ins = d.prepare("INSERT INTO snmp_vendor_profiles VALUES (?, ?, ?, NULL)");
    ins.run("hp_printer", JSON.stringify({ serial: HP_1284, model: "1.3.6.1.4.1.11.2.3.9.4.2.1.1.1.1.20.1" }), 1);
    ins.run("epson", JSON.stringify({ model: "1.3.6.1.2.1.47.1.1.1.1.13.1", serial: PRT_NOME }), 1);
    ins.run("printer_generic", JSON.stringify({ serial: PRT_NOME }), 1);
    return d;
  };

  it("le righe di serie con gli OID vecchi si correggono, una volta sola", () => {
    const d = crea();
    correggiOidProfiliStampanti(d);
    assert.equal(riga(d, "hp_printer").serial, PRT_SERIALE);
    assert.equal(riga(d, "hp_printer").partNumber, HP_PART);
    assert.equal(riga(d, "epson").serial, PRT_SERIALE);
    assert.equal(riga(d, "printer_generic").serial, PRT_SERIALE);
    const prima = riga(d, "hp_printer");
    correggiOidProfiliStampanti(d);
    assert.deepEqual(riga(d, "hp_printer"), prima);
  });

  it("le modifiche dell'utente non si toccano", () => {
    const d = crea();
    const mio = JSON.stringify({ serial: "1.3.6.1.4.1.9999.1.0" });
    d.prepare("UPDATE snmp_vendor_profiles SET fields = ? WHERE profile_id = 'hp_printer'").run(mio);
    d.prepare("UPDATE snmp_vendor_profiles SET builtin = 0 WHERE profile_id = 'epson'").run();
    correggiOidProfiliStampanti(d);
    assert.equal(riga(d, "hp_printer").serial, "1.3.6.1.4.1.9999.1.0");
    assert.equal(riga(d, "epson").serial, PRT_NOME);
  });
});

describe("i due seed non divergono", () => {
  const nomi = (file: string, funzione: string) => {
    const s = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const inizio = s.indexOf(`function ${funzione}`);
    assert.ok(inizio >= 0, funzione);
    const fine = s.indexOf("\nfunction ", inizio + 10);
    return [...s.slice(inizio, fine < 0 ? undefined : fine).matchAll(/\{ (?:name|id): "([^"]+)"/g)].map((m) => m[1]).sort();
  };

  it("regole di fingerprint: `db-hub.ts` è quello che semina le appliance", () => {
    assert.deepEqual(nomi("db-hub.ts", "seedBuiltinFingerprintRules"), nomi("db.ts", "seedBuiltinFingerprintRules"));
  });

  it("profili SNMP", () => {
    assert.deepEqual(nomi("db-hub.ts", "seedBuiltinSnmpVendorProfiles"), nomi("db.ts", "seedBuiltinSnmpVendorProfiles"));
  });

  it("le regole OT stanno nel seed delle appliance", () => {
    const hub = nomi("db-hub.ts", "seedBuiltinFingerprintRules");
    for (const r of ["Weintek HMI (MAC)", "CREVIS I/O (MAC)", "Kronotech (MAC)", "PLC Modbus (porte)", "PLC EtherNet/IP (porte)"]) assert.ok(hub.includes(r), r);
  });
});
