/**
 * GET /api/devices/[id]/mikrotik-scheda (scheda MikroTik, Task 9): 404 apparato assente, 400 non MikroTik, 200 con le
 * righe dell'ultima fotografia e lo stato della lettura della topologia preso dall'interruttore (assente = accesa di serie, ADR 0031).
 * La guardia (requireAuth prima di tutto) la tengono api-auth-guards.test.ts e scripts/verifica-permessi.sh.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/scheda-mikrotik-rotta.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-scheda-mikrotik-rotta";

import { withTenant, deleteTenantDatabase, createNetworkDevice, scriviSchedaMikrotikLettura, scriviSchedaMikrotikTopologia } from "@/lib/db-tenant";
import { parseBondScheda, parseBridgeScheda, parseDns, parsePorteBridgeScheda, parseUtenti, parseVlanBridge, parseVlanInterfacce } from "../mikrotik-scheda";
import { scriviEsito, scriviInterruttore } from "@/lib/topology/letture/interruttori";
import { riassuntoMikrotik, rispostaSchedaMikrotik, rispostaUtentiMikrotik } from "../scheda-mikrotik-rotta";
import { fonteLetturaScheda } from "@/lib/scheda/mikrotik";

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

  it("200: righe della fotografia; topologia accesa di serie senza esito → il null, poi l'ora dell'esito dell'apparato", () => {
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
      assert.deepEqual(r.body.letture, { topologia: { acceso: true, il: null }, scheda: { acceso: true, il: null, codice: null, vlan_il: null, dns_il: null } });
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

describe("Task 10: VLAN, DNS e utenti", () => {
  const lettura = () => ({
    vlanBridge: parseVlanBridge(F("mikrotik-bridge-vlan-terse.txt")), vlan: parseVlanInterfacce(F("mikrotik-vlan-terse.txt")),
    dns: parseDns(F("mikrotik-dns.txt")), utenti: parseUtenti(F("mikrotik-user-terse.txt")), comandi: 4, riusciti: 4, codice: null,
  });

  it("scheda: letture.scheda dall'interruttore e dall'esito dell'apparato; VLAN e DNS nella risposta, gli utenti MAI", () => {
    withTenant(T, () => {
      const d = nuovo("rtr-v", "10.70.0.6", "mikrotik");
      const r0 = rispostaSchedaMikrotik(d.id);
      assert.ok(r0.status === 200 && r0.body.vlanBridge === null && r0.body.dns === null, "mai letta: null");
      if (r0.status === 200) assert.deepEqual(r0.body.letture.scheda, { acceso: true, il: null, codice: null, vlan_il: null, dns_il: null });
      scriviSchedaMikrotikLettura(d.id, lettura(), new Date(Date.UTC(2026, 9, 22, 8, 0)));
      scriviInterruttore("mikrotik_scheda", true, "prova");
      scriviEsito("mikrotik_scheda", d.id, { il: "2026-10-22 08:00:00", comandi: 4, riusciti: 4, codice: null });
      const r = rispostaSchedaMikrotik(d.id);
      assert.equal(r.status, 200);
      if (r.status !== 200) return;
      assert.deepEqual(r.body.letture.scheda, { acceso: true, il: "2026-10-22 08:00:00", codice: null, vlan_il: "2026-10-22 08:00:00", dns_il: "2026-10-22 08:00:00" });
      assert.deepEqual([r.body.vlanBridge?.length, r.body.vlan?.length, r.body.dns?.servers], [12, 11, ["10.20.1.1", "10.20.1.2"]]);
      const testo = JSON.stringify(r.body);
      assert.equal(testo.includes("utente01") || testo.includes("utenti") || testo.includes("last_logged_in"), false, "la scheda per tutti non porta gli utenti");
    });
  });

  it("scheda: ultima lettura completa e bridge vlan letti vuoti → [] (non «mai letta»); lettura in parte → null", () => {
    withTenant(T, () => {
      const d = nuovo("rtr-w", "10.70.0.7", "mikrotik");
      scriviSchedaMikrotikLettura(d.id, { ...lettura(), vlanBridge: [], vlan: [] });
      scriviEsito("mikrotik_scheda", d.id, { il: "2026-10-22 08:00:00", comandi: 4, riusciti: 3, codice: "TEMPO_SCADUTO" });
      const parz = rispostaSchedaMikrotik(d.id);
      if (parz.status === 200) assert.deepEqual([parz.body.vlanBridge, parz.body.vlan], [null, null]);
      scriviEsito("mikrotik_scheda", d.id, { il: "2026-10-22 09:00:00", comandi: 4, riusciti: 4, codice: null });
      const r = rispostaSchedaMikrotik(d.id);
      if (r.status === 200) assert.deepEqual([r.body.vlanBridge, r.body.vlan], [[], []]);
    });
  });

  it("letture.scheda: una data per sezione; lettura completa alle 06, VLAN in tempo scaduto alle 09 → VLAN 06, DNS 09", () => {
    withTenant(T, () => {
      const d = nuovo("rtr-d", "10.70.0.11", "mikrotik");
      scriviSchedaMikrotikLettura(d.id, lettura(), new Date(Date.UTC(2026, 9, 22, 6, 0)));
      // alle 09 le due letture VLAN scadono (null: restano quelle delle 06), DNS e utenti si rileggono
      scriviSchedaMikrotikLettura(d.id, { ...lettura(), vlanBridge: null, vlan: null }, new Date(Date.UTC(2026, 9, 22, 9, 0)));
      scriviEsito("mikrotik_scheda", d.id, { il: "2026-10-22 09:00:00", comandi: 4, riusciti: 2, codice: "TEMPO_SCADUTO" });
      scriviInterruttore("mikrotik_scheda", true, "prova");
      const altro = nuovo("rtr-d2", "10.70.0.12", "mikrotik");
      scriviSchedaMikrotikLettura(altro.id, lettura(), new Date(Date.UTC(2026, 9, 22, 10, 0)));
      const r = rispostaSchedaMikrotik(d.id);
      assert.equal(r.status, 200);
      if (r.status === 200) {
        assert.deepEqual(r.body.letture.scheda, { acceso: true, il: "2026-10-22 09:00:00", codice: "TEMPO_SCADUTO", vlan_il: "2026-10-22 06:00:00", dns_il: "2026-10-22 09:00:00" });
        assert.equal(fonteLetturaScheda("VLAN dei bridge", r.body.letture.scheda, r.body.letture.scheda.vlan_il).quando, "22/10, 08:00 · ultima prova 22/10, 11:00: TEMPO_SCADUTO");
      }
    });
  });

  it("la data delle VLAN e del DNS non viene MAI dagli utenti (dato del solo admin)", () => {
    withTenant(T, () => {
      const d = nuovo("rtr-e", "10.70.0.13", "mikrotik");
      scriviSchedaMikrotikLettura(d.id, lettura(), new Date(Date.UTC(2026, 9, 22, 6, 0)));
      scriviSchedaMikrotikLettura(d.id, { ...lettura(), vlanBridge: null, vlan: null, dns: null }, new Date(Date.UTC(2026, 9, 22, 12, 0)));
      const r = rispostaSchedaMikrotik(d.id);
      if (r.status === 200) assert.deepEqual([r.body.letture.scheda.vlan_il, r.body.letture.scheda.dns_il], ["2026-10-22 06:00:00", "2026-10-22 06:00:00"]);
      assert.equal(rispostaUtentiMikrotik(d.id).body && (rispostaUtentiMikrotik(d.id) as { body: { letto_il: string } }).body.letto_il, "2026-10-22 12:00:00");
    });
  });

  it("utenti: 404, 400 non MikroTik, 200 con le righe e l'ora; nessuna password", () => {
    withTenant(T, () => {
      assert.equal(rispostaUtentiMikrotik(999_999).status, 404);
      assert.equal(rispostaUtentiMikrotik(nuovo("fw2", "10.70.0.19", "stormshield").id).status, 400);
      const d = nuovo("rtr-u", "10.70.0.8", "mikrotik");
      assert.deepEqual(rispostaUtentiMikrotik(d.id), { status: 200, body: { utenti: [], letto_il: null } });
      scriviSchedaMikrotikLettura(d.id, lettura(), new Date(Date.UTC(2026, 9, 22, 8, 0)));
      const r = rispostaUtentiMikrotik(d.id);
      assert.equal(r.status, 200);
      if (r.status !== 200) return;
      assert.equal(r.body.letto_il, "2026-10-22 08:00:00");
      assert.deepEqual(r.body.utenti.map((u) => [u.name, u.group]), [["utente01", "full"], ["utente02", "full"], ["utente03", "gruppo01"], ["utente04", "gruppo02"]]);
      assert.equal(JSON.stringify(r.body).toLowerCase().includes("password"), false);
    });
  });
});
