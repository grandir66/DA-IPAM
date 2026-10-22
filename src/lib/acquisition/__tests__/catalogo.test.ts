import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO, COLLECTOR_IDS, descrittore, versioneCollector, verificaCatalogo } from "../catalogo";
import type { DescrittoreCollector } from "../catalogo";
import { COLLECTORS } from "../index";
import { acquisitionInputSchema, snapshotSchema } from "../schema";

test("un elenco solo: input, snapshot e registry derivano dal catalogo", () => {
    assert.deepEqual([...COLLECTOR_IDS].sort(), Object.keys(COLLECTORS).sort());
    for (const d of CATALOGO) {
        const p = d.credenziali.una_di[0];
        const cred = { [p]: p === "snmp" ? { community: "c" } : p === "unifi" ? { api_token: "t" } : { username: "u", password: "p" } };
        assert.equal(acquisitionInputSchema.safeParse({ collector: d.id, host: "192.0.2.1", ...cred }).success, true, d.id);
    }
    assert.equal(acquisitionInputSchema.safeParse({ collector: "sconosciuto", host: "192.0.2.1", ssh: { username: "u", password: "p" } }).success, false);
    assert.deepEqual([...snapshotSchema.shape.collector.options].sort(), [...COLLECTOR_IDS].sort());
});
test("la versione del registry è quella del catalogo, per collector", () => {
    for (const d of CATALOGO) assert.equal(COLLECTORS[d.id].version, d.versione);
    assert.equal(versioneCollector("hp-procurve"), descrittore("hp-procurve").versione);
});
test("il catalogo è coerente", () => { assert.deepEqual(verificaCatalogo(CATALOGO), []); });
test("un descrittore incoerente fa fallire la verifica", () => {
    const base: DescrittoreCollector = { ...CATALOGO[0], prodotti: [...CATALOGO[0].prodotti], sezioni: [...CATALOGO[0].sezioni], collaudati: [] };
    assert.ok(verificaCatalogo([base, base]).some(p => /duplicato/.test(p)));
    assert.ok(verificaCatalogo([{ ...base, versione: "1.0" }]).some(p => /semver/.test(p)));
    assert.ok(verificaCatalogo([{ ...base, prodotti: [] }]).some(p => /prodotto/.test(p)));
    assert.ok(verificaCatalogo([{ ...base, credenziali: { ammesse: ["snmp"], una_di: ["ssh"] } }]).some(p => /credenziali/.test(p)));
    assert.ok(verificaCatalogo([{ ...base, collaudo: "non_collaudato", collaudati: [{ modello: "X", firmware: "1" }] }]).some(p => /non collaudato/.test(p)));
});
test("le allowlist dei comandi del catalogo sono quelle che i trasporti applicano", async () => {
    const { assertCommands } = await import("../transports");
    for (const d of CATALOGO) {
        if (!d.comandi) { assert.throws(() => assertCommands(["show version"], d.id)); continue; }
        assert.doesNotThrow(() => assertCommands(d.comandi, d.id));
        assert.throws(() => assertCommands(["configure terminal"], d.id));
    }
});
test("collector_version nello snapshot è per collector: una versione diversa da 1.0.0 è valida, una non semver no", async () => {
    const { collectHpProcurve } = await import("../hp-procurve");
    const ok = <T>(data: T) => ({ status: "ok" as const, data, warnings: [] });
    const snap = await collectHpProcurve({ host: "192.0.2.1", collector: "hp-procurve", ssh: { username: "u", password: "p" } }, { get: async () => ok([]), walk: async () => ok([]), shell: async c => Object.fromEntries(c.map(x => [x, { status: "error" as const, data: "", warnings: ["TEST"] }])) });
    assert.equal(snap.collector_version, versioneCollector("hp-procurve"));
    assert.equal(snapshotSchema.safeParse({ ...snap, collector_version: "1.2.0" }).success, true);
    assert.equal(snapshotSchema.safeParse({ ...snap, collector_version: "abc" }).success, false);
});

test("un collector per famiglia: nessun id duplicato o orfano, i profili d'inventario derivano dal catalogo", async () => {
    const { INVENTORY_COMMANDS } = await import("../device-profiles");
    const ids = CATALOGO.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(Object.keys(COLLECTORS).sort(), [...ids].sort(), "nessun collector senza descrittore e viceversa");
    const inventario = CATALOGO.filter(d => "motore" in d).map(d => d.id).sort();
    assert.deepEqual(Object.keys(INVENTORY_COMMANDS).sort(), inventario);
    for (const d of CATALOGO) if ("motore" in d) assert.deepEqual(INVENTORY_COMMANDS[d.id as keyof typeof INVENTORY_COMMANDS], d.comandi, `${d.id}: allowlist dal catalogo`);
    assert.equal(ids.includes("synology-nas" as never), false, "il nome definitivo è synology-dsm");
});
test("le famiglie collaudate in locale dicono il vero: collaudato con modelli; le altre non_collaudato senza modelli", () => {
    for (const d of CATALOGO) {
        if (d.collaudo === "collaudato") assert.ok(d.collaudati.length > 0, `${d.id}: collaudato senza modelli`);
        else assert.equal(d.collaudati.length, 0, d.id);
    }
    assert.deepEqual(CATALOGO.filter(d => d.collaudo === "non_collaudato").map(d => d.id).sort(), ["linux", "windows"]);
});
