/**
 * Collector `synology-dsm` (base collaudata in locale; condivisioni e pacchetti del giro 3 non ancora provati su un apparato):
 * pacchetti senza limiti silenziosi, cartelle condivise da smb.share.conf ed exports, synoshare nelle due forme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { descrittore } from "../catalogo";
import { parseInfoPacchetti, parseSynoshareEnum, parseVersioneDsm } from "../synology-nas-parsers";

test("synology-dsm: famiglia collaudata in locale; synoshare nelle due forme in allowlist", () => {
    const d = descrittore("synology-dsm");
    assert.equal(d.collaudo, "collaudato");
    assert.equal(d.motore, "inventario");
    assert.ok(d.comandi?.includes("synoshare --enum ALL") && d.comandi.includes("synoshare -enum ALL"));
    assert.ok(!d.comandi?.some(c => /sudo|reboot|set /.test(c)), "solo letture");
});

test("synology-dsm: snapshot dalla fixture (identità, condivisioni, pacchetti)", async () => {
    const { snapshot: s } = await FIXTURE["synology-dsm"].normale();
    assert.equal(s.identity.data?.firmware, "7.2.1", "il firmware resta quello del collaudo");
    assert.equal(s.identity.data?.model, "DS-LAB", "modello dal kernel DSM quando l'SNMP non c'è");
    assert.equal(s.identity.data?.serial_number, "LABS0001");
    assert.deepEqual(s.shares?.data, [{ name: "Dati", path: "/volume1/Dati", protocols: ["smb", "nfs"], comment: "Prova", public: null }]);
    assert.ok(s.shares?.warnings.includes("SYNOSHARE_NOT_READ"));
    assert.deepEqual(s.software?.data.map(p => [p.name, p.version]), [["HyperBackup", "4.1.0-3718"], ["SynologyPhotos", "1.6.2-0720"]]);
});

test("parser: versione DSM mai troncata, update 0 non scritto; pacchetti oltre 50; synoshare", () => {
    assert.equal(parseVersioneDsm('productversion="7.1"\nbuildnumber="42962"\nsmallfixnumber="0"\n').firmware, "DSM 7.1-42962");
    assert.equal(parseVersioneDsm("niente").firmware, null);
    const tanti = Array.from({ length: 60 }, (_, i) => `package="P${i}"\nversion="1.${i}"`).join("\n");
    assert.equal(parseInfoPacchetti(tanti)?.length, 60);
    assert.equal(parseInfoPacchetti("@@ formato ignoto"), null);
    assert.deepEqual(parseSynoshareEnum("Share Enum Arguments: [0xF08] ALL\nShare Num: 2\nName list:\n[Dati]\n[homes]\n"), ["Dati", "homes"]);
    assert.equal(parseSynoshareEnum("synoshare: permission denied"), null);
});
