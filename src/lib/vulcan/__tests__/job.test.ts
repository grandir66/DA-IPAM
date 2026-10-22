/**
 * A-IPAM, Task 7: i timer dell'invio verso DA-Vul-can (giro della coda ogni minuto,
 * battito ogni 15, inventario alle 03:00 ora italiana, recupero se l'ultimo inventario
 * ha più di 26 ore).
 *
 * Il freno che conta: senza `VULCAN_TOKEN` i timer girano ma ogni tic si ferma alla
 * lettura della configurazione — niente giro, niente DB, niente rete, per sempre
 * (caso 1 del piano: oggi tutte le istanze con NetBird hanno `oggetto.env` senza
 * le chiavi VULCAN). E mai due timer: `server.ts` può essere riavviato a caldo.
 *
 * Orologio e timer finti (`mock.timers`): un'ora simulata in pochi millisecondi.
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vulcan/__tests__/job.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import fs from "node:fs";
import path from "node:path";
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import cron from "node-cron";
import { migrateVulcanCoda } from "@/lib/db-tenant";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { accoda } from "../coda";
import type { ConfigVulcan } from "../config";
import type { EsitoGiroVulcan } from "../giro";
import type { RigaAuditVulcan } from "../registro";
import {
  BATTITO_OGNI_MS,
  CODA_OGNI_MS,
  CRON_INVENTARIO,
  FUSO_INVENTARIO,
  PRIMO_MS,
  RECUPERO_ORE,
  avviaInvioVulcan,
  inviaOraVulcan,
  invioOraInCorso,
  lavoroInCorso,
  type CronMinimo,
  type DipendenzeJob,
} from "../job";

const T0 = new Date("2026-10-22T08:00:00.000Z");
const OK: EsitoGiroVulcan = { esito: "ok", dettaglio: "fatto", inviati: 0 };
const SPENTO: ConfigVulcan = { stato: "spento" };
const PRONTA: ConfigVulcan = {
  stato: "pronta",
  url: new URL("https://hub.example.test"),
  token: "x".repeat(48),
  codcli: "70791",
  nodo: "70791-ipam",
  improntaGettone: "0123456789abcdef",
};

/** Svuota i microtask e le promesse in fila (setImmediate non è finto). */
const scorri = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function nuovoDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TENANT_SCHEMA_SQL);
  migrateVulcanCoda(db);
  return db;
}

interface Conti {
  config: number;
  giro: number;
  battito: number;
  inventario: number;
  db: number;
  audit: RigaAuditVulcan[];
}

function finte(config: ConfigVulcan, db: Database.Database | null = null): { dip: Partial<DipendenzeJob>; c: Conti } {
  const c: Conti = { config: 0, giro: 0, battito: 0, inventario: 0, db: 0, audit: [] };
  const dip: Partial<DipendenzeJob> = {
    config: () => {
      c.config++;
      return config;
    },
    giro: async () => {
      c.giro++;
      return OK;
    },
    battito: async () => {
      c.battito++;
      return OK;
    },
    inventario: async () => {
      c.inventario++;
      return "accodato";
    },
    db: () => {
      c.db++;
      return db;
    },
    audit: (r) => c.audit.push(r),
  };
  return { dip, c };
}

/** Un cron finto che ricorda espressione, opzioni e funzione. */
function cronFinto() {
  const visti: { espr: string; opz: { timezone?: string }; fn: () => void; fermato: boolean }[] = [];
  const c: CronMinimo = {
    schedule: (espr, fn, opz) => {
      const v = { espr, opz: opz ?? {}, fn: () => void fn(), fermato: false };
      visti.push(v);
      return { stop: () => void (v.fermato = true) };
    },
  };
  return { c, visti };
}

let ferma: (() => void) | null = null;
afterEach(() => {
  ferma?.();
  ferma = null;
  mock.timers.reset();
});

test("senza gettone per un'ora simulata: solo la lettura della configurazione", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const { dip, c } = finte(SPENTO, nuovoDb());
  const cr = cronFinto();
  ferma = avviaInvioVulcan({ ...dip, cron: cr.c });
  for (let t = 0; t < 60; t++) {
    mock.timers.tick(60_000);
    await scorri();
  }
  cr.visti[0].fn(); // anche le 03:00 arrivano
  await scorri();
  assert.ok(c.config > 0, "la configurazione si rilegge a ogni tic");
  assert.deepEqual({ giro: c.giro, battito: c.battito, inventario: c.inventario, db: c.db, audit: c.audit.length }, {
    giro: 0,
    battito: 0,
    inventario: 0,
    db: 0,
    audit: 0,
  });
});

test("con gettone: primo a 2 minuti, giro ogni minuto, battito ogni 15", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const db = nuovoDb();
  // Un inventario recente: il recupero non accoda niente.
  accoda(db, { tipo: "inventario", rif: null, json: '{"a":1}', oggetti: 1 });
  db.prepare("UPDATE vulcan_coda SET creato_il = ?").run("2026-10-22 07:00:00");
  const { dip, c } = finte(PRONTA, db);
  ferma = avviaInvioVulcan({ ...dip, cron: cronFinto().c });

  mock.timers.tick(PRIMO_MS - 1);
  await scorri();
  assert.deepEqual([c.giro, c.battito], [0, 0], "niente prima dei 2 minuti");
  mock.timers.tick(1);
  await scorri();
  assert.deepEqual([c.giro, c.battito], [1, 1], "a 2 minuti un giro e un battito");
  for (let t = 0; t < 15; t++) {
    mock.timers.tick(CODA_OGNI_MS);
    await scorri();
  }
  assert.equal(c.giro, 16, "un giro al minuto");
  assert.equal(c.battito, 2, "un battito ogni 15 minuti");
  assert.equal(c.inventario, 0);
  assert.equal(BATTITO_OGNI_MS, 15 * 60_000);
});

test("inventario alle 03:00 ora italiana, anche col cambio d'ora", () => {
  const cr = cronFinto();
  const { dip } = finte(PRONTA);
  ferma = avviaInvioVulcan({ ...dip, cron: cr.c });
  assert.equal(cr.visti.length, 1);
  assert.equal(cr.visti[0].espr, "0 3 * * *");
  assert.equal(cr.visti[0].opz.timezone, "Europe/Rome");
  // Con node-cron vero: la prossima esecuzione, letta a Roma, è alle 03:00 (ora legale e solare).
  for (const giorno of ["2026-07-10T12:00:00Z", "2026-12-10T12:00:00Z"]) {
    mock.timers.enable({ apis: ["Date"], now: new Date(giorno) });
    const t = cron.createTask(CRON_INVENTARIO, () => {}, { timezone: FUSO_INVENTARIO });
    void t.start();
    const prossima = t.getNextRun();
    void t.destroy();
    mock.timers.reset();
    assert.ok(prossima, "prossima esecuzione calcolata");
    const ora = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(prossima);
    assert.equal(ora, "03:00", `prossima esecuzione da ${giorno}`);
  }
});

test("il tic delle 03:00 accoda l'inventario solo se c'è il gettone", async () => {
  const db = nuovoDb();
  const acceso = finte(PRONTA, db);
  const cr = cronFinto();
  ferma = avviaInvioVulcan({ ...acceso.dip, cron: cr.c, primoMs: 3_600_000 });
  cr.visti[0].fn();
  await scorri();
  assert.equal(acceso.c.inventario, 1);
  ferma();
  const spento = finte(SPENTO, db);
  const cr2 = cronFinto();
  ferma = avviaInvioVulcan({ ...spento.dip, cron: cr2.c, primoMs: 3_600_000 });
  cr2.visti[0].fn();
  await scorri();
  assert.equal(spento.c.inventario, 0);
});

for (const [ore, attesi] of [
  [30, 1],
  [10, 0],
] as const) {
  test(`recupero all'avvio: ultimo inventario di ${ore} h fa → ${attesi} accodamento`, async () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
    const db = nuovoDb();
    accoda(db, { tipo: "inventario", rif: null, json: '{"a":1}', oggetti: 1 });
    const creato = new Date(T0.getTime() - ore * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
    db.prepare("UPDATE vulcan_coda SET creato_il = ?").run(creato);
    const { dip, c } = finte(PRONTA, db);
    ferma = avviaInvioVulcan({ ...dip, cron: cronFinto().c });
    mock.timers.tick(PRIMO_MS);
    await scorri();
    assert.equal(c.inventario, attesi);
    assert.ok(RECUPERO_ORE === 26);
  });
}

test("recupero: mai un inventario → si accoda; un inventario appena accodato non si ripete al battito dopo", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const db = nuovoDb();
  const { dip, c } = finte(PRONTA, db);
  dip.inventario = async () => {
    c.inventario++;
    accoda(db, { tipo: "inventario", rif: null, json: `{"n":${c.inventario}}`, oggetti: 1 });
    db.prepare("UPDATE vulcan_coda SET creato_il = ?").run("2026-10-22 08:02:00");
    return "accodato";
  };
  ferma = avviaInvioVulcan({ ...dip, cron: cronFinto().c });
  mock.timers.tick(PRIMO_MS);
  await scorri();
  assert.equal(c.inventario, 1);
  mock.timers.tick(BATTITO_OGNI_MS);
  await scorri();
  assert.equal(c.inventario, 1);
});

test("avviato due volte (riavvio a caldo): un solo timer e un solo cron", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const { dip, c } = finte(PRONTA, nuovoDb());
  const cr = cronFinto();
  const s1 = avviaInvioVulcan({ ...dip, cron: cr.c });
  const s2 = avviaInvioVulcan({ ...dip, cron: cr.c });
  ferma = s1;
  assert.equal(s1, s2);
  assert.equal(cr.visti.length, 1);
  mock.timers.tick(PRIMO_MS);
  await scorri();
  assert.equal(c.giro, 1);
  s1();
  assert.equal(cr.visti[0].fermato, true, "lo stop ferma anche il cron");
  mock.timers.tick(10 * CODA_OGNI_MS);
  await scorri();
  assert.equal(c.giro, 1, "dopo lo stop non gira più");
});

test("un giro che lancia non ferma il timer", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const { dip, c } = finte(PRONTA, nuovoDb());
  dip.giro = async () => {
    c.giro++;
    throw new Error("imprevisto");
  };
  const errori = mock.method(console, "error", () => {});
  ferma = avviaInvioVulcan({ ...dip, cron: cronFinto().c });
  for (const passo of [PRIMO_MS, CODA_OGNI_MS, CODA_OGNI_MS]) {
    mock.timers.tick(passo);
    await scorri();
  }
  errori.mock.restore();
  assert.equal(c.giro, 3);
});

test("due «Invia ora» insieme: un giro solo, e un audit con l'utente", async () => {
  const db = nuovoDb();
  const { dip, c } = finte(PRONTA, db);
  let sblocca: () => void = () => {};
  dip.giro = () => {
    c.giro++;
    return new Promise<EsitoGiroVulcan>((r) => (sblocca = () => r(OK)));
  };
  const a = inviaOraVulcan("mario", dip);
  const b = inviaOraVulcan("luigi", dip);
  await scorri();
  assert.equal(lavoroInCorso(), true);
  sblocca();
  assert.deepEqual(await a, await b);
  assert.equal(c.giro, 1);
  assert.equal(c.battito, 1);
  assert.equal(c.inventario, 1);
  assert.deepEqual(c.audit, [{ azione: "invia_ora", da: "mario" }]);
  assert.equal(lavoroInCorso(), false);
});

test("«Invia ora» rimette in attesa i falliti", async () => {
  const db = nuovoDb();
  const r = accoda(db, { tipo: "ad-health", rif: "8", json: '{"x":1}', oggetti: null });
  db.prepare("UPDATE vulcan_coda SET stato = 'fallito', tentativi = 12 WHERE id = ?").run(r.id);
  const { dip } = finte(PRONTA, db);
  await inviaOraVulcan("mario", dip);
  const riga = db.prepare("SELECT stato, tentativi FROM vulcan_coda WHERE id = ?").get(r.id);
  assert.deepEqual({ ...(riga as object) }, { stato: "in_attesa", tentativi: 0 });
});

test("«Invia ora» senza gettone: niente giro, niente audit", async () => {
  const { dip, c } = finte(SPENTO, nuovoDb());
  const e = await inviaOraVulcan("mario", dip);
  assert.equal(e.esito, "spento");
  assert.deepEqual([c.giro, c.battito, c.inventario, c.db, c.audit.length], [0, 0, 0, 0, 0]);
});

test("dipendenze vere, oggetto.env assente, 20 minuti simulati: nessuna riga [vulcan], nessun audit", async () => {
  // Il caso di oggi su ogni istanza: il file non c'è (o non ha VULCAN_TOKEN).
  const prima = process.env.DALINK_OGGETTO_ENV;
  process.env.DALINK_OGGETTO_ENV = path.join(TEST_DATA_DIR, "non-esiste", "oggetto.env");
  const righe: string[] = [];
  const spie = (["log", "warn", "error"] as const).map((m) =>
    mock.method(console, m, (...a: unknown[]) => void righe.push(a.map(String).join(" "))),
  );
  try {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
    const cr = cronFinto();
    ferma = avviaInvioVulcan({ cron: cr.c });
    for (let t = 0; t < 20; t++) {
      mock.timers.tick(60_000);
      await scorri();
    }
    cr.visti[0].fn();
    await scorri();
  } finally {
    for (const s of spie) s.mock.restore();
    if (prima === undefined) delete process.env.DALINK_OGGETTO_ENV;
    else process.env.DALINK_OGGETTO_ENV = prima;
  }
  assert.deepEqual(righe.filter((r) => r.includes("[vulcan]")), []);
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, "audit")), false, "nessun file di audit");
  assert.equal(lavoroInCorso(), false);
});

test("«Invia ora» in corso si distingue da un giro automatico in corso (la rotta fa 409 solo nel primo caso)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const { dip, c } = finte(PRONTA, nuovoDb());
  let sblocca: () => void = () => {};
  dip.giro = () => {
    c.giro++;
    return new Promise<EsitoGiroVulcan>((r) => (sblocca = () => r(OK)));
  };
  ferma = avviaInvioVulcan({ ...dip, cron: cronFinto().c });
  mock.timers.tick(PRIMO_MS);
  await scorri();
  assert.equal(lavoroInCorso(), true, "il giro automatico è in corso");
  assert.equal(invioOraInCorso(), false, "un «Invia ora» si può ancora mettere in fila");
  const ora = inviaOraVulcan("mario", dip);
  assert.equal(invioOraInCorso(), true);
  sblocca();
  await scorri();
  sblocca();
  await ora;
  assert.equal(invioOraInCorso(), false);
  assert.equal(c.giro, 2, "il giro automatico e poi quello di «Invia ora»");
});
