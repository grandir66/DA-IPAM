/**
 * Prova di contratto comune (C0.5): vale per OGNI collector del catalogo, presente e futuro.
 * Una famiglia nuova senza fixture in `contratto-fixture.ts` fa fallire questa suite (e `tsc`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGO, COLLECTOR_IDS, descrittore } from "../catalogo";
import type { CollectorId } from "../catalogo";
import { COLLECTORS } from "../index";
import { acquisitionInputSchema, snapshotSchema } from "../schema";
import { FIXTURE, SEGRETO } from "./contratto-fixture";

const SEZIONI_A_LISTA = ["interfaces", "vlans", "forwarding", "neighbors", "aggregation"] as const;
const SEZIONI_SOLO_SSH = ["neighbors", "spanning_tree", "aggregation", "sensors"] as const;
const usaSsh = (id: CollectorId) => descrittore(id).credenziali.ammesse.includes("ssh");
const ids = [...COLLECTOR_IDS];

test("ogni collector del catalogo ha implementazione, descrittore coerente e fixture", () => {
    assert.deepEqual(Object.keys(FIXTURE).sort(), [...ids].sort(), "fixture mancante o in più");
    assert.deepEqual(Object.keys(COLLECTORS).sort(), [...ids].sort());
    for (const id of ids) {
        assert.equal(typeof COLLECTORS[id].collect, "function", id);
        assert.equal(FIXTURE[id].richiesta.collector, id, `la richiesta della fixture ${id} nomina un altro collector`);
        assert.equal(acquisitionInputSchema.safeParse(FIXTURE[id].richiesta).success, true, `${id}: la richiesta della fixture non passa lo schema`);
    }
});

for (const id of ids) {
    const d = descrittore(id);

    test(`${id}: fixture → snapshot valido, versione del catalogo, nessun segreto`, async () => {
        const { snapshot } = await FIXTURE[id].normale();
        assert.equal(snapshotSchema.safeParse(snapshot).success, true);
        assert.equal(snapshot.schema_version, "1.0");
        assert.equal(snapshot.collector, id);
        assert.equal(snapshot.collector_version, d.versione);
        // Una console di controller non è un apparato singolo: la sua identità è `skipped` per costruzione.
        const attese = d.famiglia === "controller" ? ["skipped"] : ["ok", "partial"];
        assert.ok(attese.includes(snapshot.identity.status), `identity ${snapshot.identity.status}`);
        assert.equal(JSON.stringify(snapshot).includes(SEGRETO), false);
    });

    test(`${id}: trasporto guasto (errore che nomina il segreto) → stato error, senza eccezione né segreto, nessun secondo tentativo`, async () => {
        const { snapshot, chiamateShell } = await FIXTURE[id].trasportoGuasto();
        assert.equal(snapshot.status, "error");
        assert.equal(snapshotSchema.safeParse(snapshot).success, true);
        assert.equal(JSON.stringify(snapshot).includes(SEGRETO), false);
        assert.ok(chiamateShell <= 1, `${chiamateShell} aperture di shell`);
    });

    if (FIXTURE[id].formatoIgnoto) {
        test(`${id}: formato di uscita ignoto → mai ok, nessuna sezione a lista dichiarata ok`, async () => {
            const { snapshot } = await FIXTURE[id].formatoIgnoto!();
            assert.notEqual(snapshot.status, "ok");
            for (const nome of SEZIONI_A_LISTA) assert.notEqual(snapshot[nome].status, "ok", `${nome} ok su un'uscita illeggibile`);
            assert.equal(JSON.stringify(snapshot).includes(SEGRETO), false);
        });
    }

    if (FIXTURE[id].senzaSsh) {
        test(`${id}: senza credenziale SSH nessuna shell aperta e le sezioni che la richiedono sono skipped`, async () => {
            const { snapshot, chiamateShell } = await FIXTURE[id].senzaSsh!();
            assert.equal(chiamateShell, 0);
            assert.equal(snapshotSchema.safeParse(snapshot).success, true);
            for (const nome of SEZIONI_SOLO_SSH) assert.equal(snapshot[nome].status, "skipped", nome);
            assert.equal(JSON.stringify(snapshot).includes(SEGRETO), false);
        });
    }

    if (!usaSsh(id)) {
        test(`${id}: credenziali di un altro tipo (ssh al posto della sua) respinte dallo schema`, () => {
            // Senza le credenziali che il collector ammette (api, winrm...) la richiesta non passa, e nemmeno con SSH al loro posto.
            const resto = Object.fromEntries(Object.entries(FIXTURE[id].richiesta as Record<string, unknown>).filter(([k]) => !(d.credenziali.ammesse as readonly string[]).includes(k)));
            assert.equal(acquisitionInputSchema.safeParse({ ...resto, ssh: { username: "u", password: "p" } }).success, false);
            assert.equal(acquisitionInputSchema.safeParse(resto).success, false);
        });
    }
}

test("il catalogo non nomina collector senza prova: tanti test di contratto quanti collector", () => {
    assert.equal(CATALOGO.length, ids.length);
});
