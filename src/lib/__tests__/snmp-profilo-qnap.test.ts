/**
 * Profilo SNMP storico `qnap`: gli OID `…24681.1.2.1/.2/.3` sono CPU %, memoria totale e libera (collaudo QNAP
 * 22/10/2026: firmware = «15979.0 MB»). Un hub che li ha ancora si corregge; un valore-misura non è mai identità.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/__tests__/snmp-profilo-qnap.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { correggiOidProfiloQnap } from "@/lib/db-hub";
import { identitaQnap } from "@/lib/scanner/qnap-oid";
import { valoreCampoProfilo } from "@/lib/scanner/snmp-query";

const VECCHIO = JSON.stringify({ model: "1.3.6.1.4.1.24681.1.2.1.0", firmware: "1.3.6.1.4.1.24681.1.2.2.0", serial: "1.3.6.1.4.1.24681.1.2.3.0", temperature: "1.3.6.1.4.1.24681.1.2.7.0" });

function hubConProfilo(fields: string, builtin = 1): Database.Database {
    const db = new Database(":memory:");
    db.exec(HUB_SCHEMA_SQL);
    db.prepare("INSERT INTO snmp_vendor_profiles (profile_id, name, category, enterprise_oid_prefixes, fields, confidence, enabled, builtin) VALUES ('qnap','QNAP QTS','storage','[\"1.3.6.1.4.1.24681\"]',?,0.98,1,?)").run(fields, builtin);
    return db;
}
const leggi = (db: Database.Database) => JSON.parse((db.prepare("SELECT fields FROM snmp_vendor_profiles WHERE profile_id='qnap'").get() as { fields: string }).fields) as Record<string, unknown>;

test("hub con gli OID sbagliati: corretto, senza firmware, e la seconda volta non cambia nulla", () => {
    const db = hubConProfilo(VECCHIO);
    correggiOidProfiloQnap(db);
    const f = leggi(db);
    assert.ok(!JSON.stringify(f).match(/24681\.1\.2\.[123]\.0/), "nessuno dei tre OID di CPU/memoria");
    assert.equal(f.firmware, undefined);
    assert.deepEqual(f.model, ["1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1", "1.3.6.1.4.1.55062.1.12.3.0"]);
    const prima = JSON.stringify(f);
    correggiOidProfiloQnap(db);
    assert.equal(JSON.stringify(leggi(db)), prima);
});

test("un profilo modificato dall'utente (non builtin) non si tocca", () => {
    const db = hubConProfilo(VECCHIO, 0);
    correggiOidProfiloQnap(db);
    assert.equal(JSON.stringify(leggi(db)), JSON.stringify(JSON.parse(VECCHIO)));
});

test("valore-misura (MB, %) mai modello, firmware o seriale; un valore assente resta assente", () => {
    for (const v of ["15979.0 MB", "12 %", "8 GB", "41 C"]) {
        assert.equal(identitaQnap(v), null, v);
        for (const k of ["model", "firmware", "serial"]) assert.equal(valoreCampoProfilo(k, v), null, `${k} ${v}`);
    }
    assert.equal(identitaQnap(""), null);
    assert.equal(identitaQnap(undefined), null);
    assert.equal(valoreCampoProfilo("serial", "Q000LAB01"), "Q000LAB01");
    assert.equal(valoreCampoProfilo("firmware", "5.1.3"), "5.1.3");
    assert.equal(valoreCampoProfilo("temperature", "41"), "41");
});
