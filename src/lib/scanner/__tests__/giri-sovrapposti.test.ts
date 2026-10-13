// T3-22 (INV-1, INV-2): due giri sovrapposti sulla stessa rete.
//
// Prima della parte 3b della tappa 3, su una rete di DTS:
// - un secondo giro partiva sulla stessa rete mentre il primo era in corso;
// - il primo, finendo, spegneva gli host che il secondo (o un'altra fonte) aveva
//   visto vivi dopo la sua partenza;
// - un giro che non vedeva nessuno spegneva l'intera rete.
// La stessa sequenza gira, con lo script `scripts/prova-giri-sovrapposti.ts`,
// su una copia del DB di DTS; qui gira su un tenant di prova con la forma vera
// delle righe, così resta nelle prove del repo.
//
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/giri-sovrapposti.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { eseguiGiriSovrapposti, scegliRete } from "./support/giri-sovrapposti";
import { togliGuardiaRete } from "./support/guardia-rete";
import { controllaPercorsi } from "./support/percorsi-prova";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";

const T = "TESTGIRISOVRAPPOSTI";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Giri sovrapposti",
  indirizzo: null,
  citta: null,
  provincia: null,
  cap: null,
  telefono: null,
  email: null,
  piva: null,
  cf: null,
  referente: null,
  note: null,
  active: 1,
});

after(() => {
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

/**
 * Rete /26 con 15 host online visti giorni fa, 6 offline e 2 in stato
 * «unknown»; una /16 più popolata che la prova deve scartare (troppo grande).
 */
function preparaTenant(): void {
  const d = getTenantDb(T);
  const grande = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.240.0.0/16', 'grande')").run().lastInsertRowid);
  const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.241.0.0/26', 'prova')").run().lastInsertRowid);
  const ins = d.prepare(
    "INSERT INTO hosts (network_id, ip, status, last_seen, updated_at) VALUES (?, ?, ?, '2026-10-10 08:00:00', '2026-10-10 08:00:00')",
  );
  for (let i = 1; i <= 20; i++) ins.run(grande, `10.240.0.${i}`, "online");
  for (let i = 1; i <= 15; i++) ins.run(rete, `10.241.0.${i}`, "online");
  for (let i = 20; i < 26; i++) ins.run(rete, `10.241.0.${i}`, "offline");
  for (let i = 30; i < 32; i++) ins.run(rete, `10.241.0.${i}`, "unknown");
}

test("due giri sulla stessa rete: B rifiutato, nessun host visto dopo l'avvio di A spento, giro a zero vivi senza scritture", async () => {
  preparaTenant();
  const scelta = scegliRete(getTenantDb(T));
  assert.ok(scelta);
  assert.equal(scelta.cidr, "10.241.0.0/26", "la rete troppo grande non va scelta");

  const r = await eseguiGiriSovrapposti(T);

  assert.equal(r.tentativiRete, 0, "la prova ha provato a uscire sulla rete");
  assert.deepEqual(
    { host: r.rete.host, online: r.rete.online, offline: r.rete.offline, altri: r.rete.altri, ip: r.rete.ipScansionati },
    { host: 23, online: 15, offline: 6, altri: 2, ip: 62 },
  );
  assert.equal(r.giroB.rifiutato, true, "il giro B è partito sulla rete occupata");
  assert.equal(r.giroA.esito, "completed");
  assert.equal(r.giroA.viviNelGiro, 12);
  assert.equal(r.giroA.nonVistiDaA, 3);
  assert.equal(r.giroA.vistiDopoAvvio, 2);
  assert.equal(r.giroA.spentiVistiDopo, 0, "A ha spento host visti dopo la sua partenza");
  // Spenti da A: l'online non visto da nessuno e i due «unknown» (sotto soglia: 3 su 17).
  assert.equal(r.giroA.passatiOffline, 3);
  assert.equal(r.giroA.offlineRiscritti, 0, "A ha riscritto offline host già offline");
  // Scritture di stato di A: i 12 vivi riconfermati online e i 3 spenti.
  assert.equal(r.giroA.scrittureStato, 15);
  assert.equal(r.giroZero.esito, "completed");
  assert.equal(r.giroZero.onlinePrima, 14);
  assert.equal(r.giroZero.passatiOffline, 0, "il giro a zero vivi ha spento host");
  assert.equal(r.giroZero.scrittureStato, 0, "il giro a zero vivi ha scritto lo stato");
  assert.deepEqual(r.verdetto, { ok: true, motivi: [] });
});

test("controllo dei percorsi: rifiuta ciò che sta fuori dalla cartella di lavoro", () => {
  const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), "giri-percorsi-"));
  try {
    const sorgente = path.join(lavoro, "71734.db");
    fs.writeFileSync(sorgente, "");
    const buoni = {
      scratchpad: lavoro,
      sorgente,
      dataDir: path.join(lavoro, "giro", "data"),
      hubDb: path.join(lavoro, "giro", "hub.db"),
      repo: process.cwd(),
    };
    assert.deepEqual(controllaPercorsi(buoni), []);

    assert.ok(controllaPercorsi({ ...buoni, dataDir: path.join(process.cwd(), "data") }).includes("cartella dei dati fuori dalla cartella di lavoro"));
    assert.ok(controllaPercorsi({ ...buoni, hubDb: path.join(process.cwd(), "data", "hub.db") }).includes("hub di prova fuori dalla cartella di lavoro"));
    assert.ok(controllaPercorsi({ ...buoni, sorgente: path.join(process.cwd(), "data", "tenants", "x.db") }).includes("database sorgente fuori dalla cartella di lavoro"));
    // La cartella di lavoro dentro il repo non vale, anche se è «temporanea» per nome.
    assert.ok(controllaPercorsi({ ...buoni, scratchpad: process.cwd() }).includes("la cartella di lavoro sta dentro il repo"));
    // Un `..` non porta fuori.
    assert.ok(controllaPercorsi({ ...buoni, dataDir: path.join(lavoro, "..", "altrove") }).includes("cartella dei dati fuori dalla cartella di lavoro"));
    // Cartella dei dati già usata: si riparte da zero.
    fs.mkdirSync(buoni.dataDir, { recursive: true });
    fs.writeFileSync(path.join(buoni.dataDir, "hub.db"), "");
    assert.ok(controllaPercorsi(buoni).includes("la cartella dei dati non è vuota"));
  } finally {
    fs.rmSync(lavoro, { recursive: true, force: true });
  }
});
