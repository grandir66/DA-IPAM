/**
 * Collector `synology-nas` (non collaudato): firmware DSM intero (versione, build, update), pacchetti senza limiti
 * silenziosi, cartelle condivise da smb.share.conf ed exports, synoshare nelle due forme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { descrittore } from "../catalogo";
import { parseInfoPacchetti, parseSynoshareEnum, parseVersioneDsm } from "../synology-nas-parsers";

test("synology-nas: non collaudato; synoshare nelle due forme in allowlist", () => {
    const d = descrittore("synology-nas");
    assert.equal(d.collaudo, "non_collaudato");
    assert.ok(d.comandi?.includes("synoshare --enum ALL") && d.comandi.includes("synoshare -enum ALL"));
});

test("synology-nas: snapshot dalla fixture", async () => {
    const { snapshot: s } = await FIXTURE["synology-nas"].normale();
    assert.equal(s.identity.data?.firmware, "DSM 7.2.1-69057 Update 5");
    assert.equal(s.identity.data?.model, "DS-LAB");
    assert.deepEqual(s.shares?.data, [{ name: "Dati", path: "/volume1/Dati", protocols: ["smb", "nfs"], comment: "Prova", public: null }]);
    assert.ok(s.shares?.warnings.includes("SYNOSHARE_NOT_READ"));
    assert.deepEqual(s.software?.data.map(p => [p.name, p.version]), [["HyperBackup", "4.1.0-3718"], ["SynologyPhotos", "1.6.2-0720"]]);
    assert.equal(s.host_storage?.data.filesystems[0].inodes_total, "0", "zero è un dato (btrfs non conta gli inode)");
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
