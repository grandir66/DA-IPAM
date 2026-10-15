/**
 * Tappa C1, Task 7: i fatti dell'istanza che entrano nel segnale.
 *
 * - I numeri dell'inventario si contano sul database del cliente (schema vero, in
 *   memoria): righe di `hosts` e `networks`, ultima riga di `scan_history`.
 * - La salute porta solo verdetti, mai il testo di dettaglio delle sonde (può
 *   contenere indirizzi e nomi della rete del cliente).
 * - Se il codice cliente di DA-Link non è un cliente di questa istanza, non si
 *   chiedono moduli e salute, e la salute lo dice.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO.
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { fattiIstanza, inventarioDaDb, saluteFirewall } from "../fatti";

after(() => {
  closeHubDb();
  removeTestHubDb();
});

test("inventarioDaDb: conteggi e ultima scansione sullo schema vero", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.0.0.0/24', 'a'), ('10.0.1.0/24', 'b')").run();
  const ins = db.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, ?)");
  for (let i = 1; i <= 5; i++) ins.run(1, `10.0.0.${i}`);
  ins.run(2, "10.0.1.1");
  db.prepare("INSERT INTO scan_history (network_id, scan_type, status, timestamp) VALUES (1, 'ping', 'completed', '2026-10-15 02:00:00')").run();
  db.prepare("INSERT INTO scan_history (network_id, scan_type, status, timestamp) VALUES (2, 'nmap', 'failed', '2026-10-15 03:00:00')").run();
  assert.deepEqual(inventarioDaDb(db), {
    dispositivi: 6,
    reti: 2,
    ultima_scansione: "2026-10-15 03:00:00",
    esito_scansione: "failed",
  });
  db.close();
});

test("inventarioDaDb: database vuoto → zeri e nessuna scansione", () => {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  assert.deepEqual(inventarioDaDb(db), { dispositivi: 0, reti: 0, ultima_scansione: null, esito_scansione: null });
  db.close();
});

test("cliente non trovato: moduli e salute non si chiedono, la salute lo dice", async () => {
  let chiesto = false;
  const r = await fattiIstanza("99999", null, {
    porte: async () => ({ fonte: "firewall", porte: [22, 443], sorgentiRistrette: true, wt0Presente: true }),
    moduli: async () => {
      chiesto = true;
      return {};
    },
    salute: async () => {
      chiesto = true;
      return {};
    },
  });
  assert.equal(chiesto, false);
  assert.equal(r.clienteTrovato, false);
  assert.deepEqual(r.fatti.moduli, {});
  assert.equal(r.fatti.salute.cliente, "non_trovato");
  assert.equal(r.fatti.salute.firewall_wt0, "attivo");
  assert.equal(r.fatti.salute.interfaccia_wt0, "presente");
  assert.deepEqual(r.fatti.porte, [22, 443]);
});

test("cliente trovato: moduli accesi e solo i verdetti della salute", async () => {
  const r = await fattiIstanza("99999", "segnale precedente: x", {
    clienteEsiste: () => true,
    porte: async () => ({ fonte: "ascolto", porte: [22, 80], sorgentiRistrette: false, wt0Presente: false }),
    moduli: async () => ({ edge: true, wazuh: true }),
    salute: async () => ({ edge: "ok", wazuh: "degraded" }),
  });
  assert.equal(r.clienteTrovato, true);
  assert.deepEqual(r.fatti.moduli, { edge: true, wazuh: true });
  assert.deepEqual(r.fatti.salute, {
    edge: "ok",
    wazuh: "degraded",
    cliente: "trovato",
    firewall_wt0: "assente",
    interfaccia_wt0: "assente",
  });
  assert.equal(r.fatti.ultimoErrore, "segnale precedente: x");
  assert.match(r.fatti.versione, /^\d+\.\d+\.\d+/);
});

test("la salute riguarda solo i moduli accesi (più il sistema): un modulo spento non è «in errore»", async () => {
  // Visto a schermo il 15/10: su un'istanza senza moduli configurati ogni sonda dava
  // «fail», e il segnale avrebbe detto a Domarc nove moduli in errore.
  const r = await fattiIstanza("99999", null, {
    clienteEsiste: () => true,
    porte: async () => ({ fonte: "non_so", porte: [], sorgentiRistrette: false, wt0Presente: false }),
    moduli: async () => ({ edge: true, wazuh: false, librenms: false, appliance: false }),
    salute: async () => ({ edge: "ok", wazuh: "fail", librenms: "fail", appliance: "degraded" }),
  });
  assert.equal(r.fatti.salute.edge, "ok");
  assert.equal(r.fatti.salute.appliance, "degraded");
  assert.ok(!("wazuh" in r.fatti.salute));
  assert.ok(!("librenms" in r.fatti.salute));
});

test("una sonda che fallisce non ferma il segnale: la salute dice non_so", async () => {
  const r = await fattiIstanza("99999", null, {
    clienteEsiste: () => true,
    porte: async () => ({ fonte: "non_so", porte: [], sorgentiRistrette: false, wt0Presente: false }),
    moduli: async () => {
      throw new Error("x");
    },
    salute: async () => {
      throw new Error("y");
    },
  });
  assert.deepEqual(r.fatti.moduli, {});
  assert.equal(r.fatti.salute.moduli, "non_so");
  assert.equal(r.fatti.salute.firewall_wt0, "non_so");
});

test("saluteFirewall: le quattro voci", () => {
  assert.equal(saluteFirewall({ fonte: "firewall", porte: [], sorgentiRistrette: true, wt0Presente: true }), "attivo");
  assert.equal(saluteFirewall({ fonte: "firewall", porte: [], sorgentiRistrette: false, wt0Presente: true }), "attivo_sorgenti_aperte");
  assert.equal(saluteFirewall({ fonte: "ascolto", porte: [], sorgentiRistrette: false, wt0Presente: true }), "assente");
  assert.equal(saluteFirewall({ fonte: "non_so", porte: [], sorgentiRistrette: false, wt0Presente: false }), "non_so");
});
