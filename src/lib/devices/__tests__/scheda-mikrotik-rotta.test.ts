/**
 * GET /api/devices/[id]/mikrotik-scheda (scheda MikroTik, Task 9): 404 apparato assente, 400 non MikroTik, 200 con le
 * righe dell'ultima fotografia e lo stato della lettura della topologia preso dall'interruttore (spenta = assente).
 * La guardia (requireAuth prima di tutto) la tengono api-auth-guards.test.ts e scripts/verifica-permessi.sh.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/scheda-mikrotik-rotta.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-scheda-mikrotik-rotta";

import { withTenant, deleteTenantDatabase, createNetworkDevice, scriviSchedaMikrotikTopologia } from "@/lib/db-tenant";
import { parseBondScheda, parseBridgeScheda, parsePorteBridgeScheda } from "../mikrotik-scheda";
import { scriviEsito, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { riassuntoMikrotik, rispostaSchedaMikrotik } from "../scheda-mikrotik-rotta";

const T = "TESTSCHEDAMKROTTA";
after(() => deleteTenantDatabase(T));
const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

const nuovo = (nome: string, host: string, vendor: string) =>
  createNetworkDevice({ name: nome, host, device_type: "router", vendor, protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router" } as never);

describe("rispostaSchedaMikrotik", () => {
  it("404 apparato assente, 400 non MikroTik", () => {
    withTenant(T, () => {
      assert.equal(rispostaSchedaMikrotik(999_999).status, 404);
      const altro = nuovo("fw", "10.70.0.9", "stormshield");
      assert.equal(rispostaSchedaMikrotik(altro.id).status, 400);
    });
  });

  it("200: righe della fotografia; topologia spenta → acceso false, poi accesa con l'ora dell'esito dell'apparato", () => {
    withTenant(T, () => {
      const d = nuovo("rtr", "10.70.0.1", "mikrotik");
      scriviSchedaMikrotikTopologia(d.id, {
        bridge: parseBridgeScheda(F("mikrotik-mk3-testa.txt")), porte: parsePorteBridgeScheda(F("mikrotik-mk4-testa.txt")), bond: parseBondScheda(F("mikrotik-mk8a-testa.txt")),
      }, new Date(Date.UTC(2026, 9, 21, 8, 0)));
      const r = rispostaSchedaMikrotik(d.id);
      assert.equal(r.status, 200);
      if (r.status !== 200) return;
      assert.deepEqual([r.body.bridge.length, r.body.porte.length, r.body.bond.length], [1, 10, 3]);
      assert.equal(r.body.letto_il, "2026-10-21 08:00:00");
      assert.deepEqual(r.body.letture, { topologia: { acceso: false, il: null }, scheda: { acceso: false, il: null } });
      assert.equal(r.body.vlanBridge, null);

      scriviInterruttore("mikrotik", true, "prova");
      scriviEsito("mikrotik", d.id, { il: "2026-10-21 09:15:00", comandi: 6, riusciti: 6, codice: null });
      scriviEsito("mikrotik", d.id + 1, { il: "2026-10-21 10:00:00", comandi: 6, riusciti: 0, codice: "X" });
      const r2 = rispostaSchedaMikrotik(d.id);
      assert.equal(r2.status, 200);
      if (r2.status === 200) assert.deepEqual(r2.body.letture.topologia, { acceso: true, il: "2026-10-21 09:15:00" });
    });
  });
});

describe("riassuntoMikrotik (GET /api/devices/[id], campo mikrotik)", () => {
  it("righe presenti: la lettura accesa o spenta viaggia col conteggio", () => {
    withTenant(T, () => {
      const d = nuovo("rtr-r", "10.70.0.5", "mikrotik");
      scriviSchedaMikrotikTopologia(d.id, { bridge: parseBridgeScheda(F("mikrotik-mk3-testa.txt")), porte: null, bond: null }, new Date(Date.UTC(2026, 9, 21, 8, 0)));
      scriviInterruttore("mikrotik", true, "prova");
      assert.deepEqual(riassuntoMikrotik(d.id), { bridge: 1, letto_il: "2026-10-21 08:00:00", topologia_accesa: true });
      scriviInterruttore("mikrotik", false, "prova");
      assert.deepEqual(riassuntoMikrotik(d.id), { bridge: 1, letto_il: "2026-10-21 08:00:00", topologia_accesa: false });
    });
  });
});
