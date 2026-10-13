// T3-20 (INV-1, INV-2): un giro vecchio non spegne un host visto dopo la sua
// partenza, e non riscrive gli host già offline.
//
// Prima di questa correzione il passaggio a offline di fine giro toccava ogni IP
// scansionato che non aveva risposto, senza guardare né lo stato né `last_seen`:
// - un host visto vivo DOPO l'inizio del giro (da un altro giro, dal controllo
//   degli host noti) veniva spento dal giro partito prima, che non l'aveva visto;
// - gli host già offline si vedevano riscrivere `updated_at` a ogni giro (fino a
//   248 righe per giro su una rete di DTS, misurato il 12/10).
// Ora il filtro è uno solo, usato sia dalla lettura dei candidati
// (`selectOfflineCandidates`, che servirà alla soglia di T3-21) sia dalla
// scrittura: stato diverso da offline e `last_seen` nullo o anteriore
// all'inizio del giro.
//
// La prova d'integrazione usa il banco delle scansioni di T3-16. Lanciare con
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/__tests__/mark-hosts-offline.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { tentativiBloccati, togliGuardiaRete } from "@/lib/scanner/__tests__/support/guardia-rete";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import {
  deleteTenantDatabase,
  getTenantDb,
  markHostsOffline,
  oraDelDatabase,
  selectOfflineCandidates,
  upsertHost,
  withTenant,
} from "@/lib/db-tenant";
import { discoverNetwork } from "@/lib/scanner/discovery";
import {
  creaEsecutoreFinto,
  installaEsecutoreFinto,
  togliEsecutoreFinto,
} from "@/lib/scanner/__tests__/support/esecutore-finto";

const T = "TESTMARKOFFLINE";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Passaggio a offline",
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

beforeEach(() => {
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
  tentativiBloccati.length = 0;
});

after(() => {
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function db() {
  return getTenantDb(T);
}

// Le date hanno la forma di `datetime('now')` di SQLite, come le scrive l'app.
const INIZIO = "2026-10-12 10:00:00";
const PRIMA = "2026-10-12 09:00:00";
const DOPO = "2026-10-12 10:30:00";
const VECCHIO_UPDATED = "2026-10-01 08:00:00";

interface RigaFinta {
  ip: string;
  status: "online" | "offline" | "unknown";
  last_seen: string | null;
}

function preparaRete(righe: RigaFinta[]): number {
  const d = db();
  const id = Number(
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.250.0.0/29', 'offline')").run().lastInsertRowid,
  );
  const ins = d.prepare(
    "INSERT INTO hosts (network_id, ip, status, last_seen, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const r of righe) ins.run(id, r.ip, r.status, r.last_seen, VECCHIO_UPDATED);
  return id;
}

function stato(reteId: number): Array<{ ip: string; status: string; updated_at: string }> {
  return db()
    .prepare("SELECT ip, status, updated_at FROM hosts WHERE network_id = ? ORDER BY ip")
    .all(reteId) as Array<{ ip: string; status: string; updated_at: string }>;
}

const SCANSIONATI = ["10.250.0.1", "10.250.0.2", "10.250.0.3", "10.250.0.4", "10.250.0.5", "10.250.0.6"];

test("un host visto vivo dopo l'inizio del giro resta online", () => {
  const reteId = withTenant(T, () => preparaRete([{ ip: "10.250.0.2", status: "online", last_seen: DOPO }]));
  const cambiati = withTenant(T, () => markHostsOffline(reteId, [], SCANSIONATI, INIZIO));
  assert.equal(stato(reteId)[0].status, "online");
  assert.equal(stato(reteId)[0].updated_at, VECCHIO_UPDATED);
  assert.equal(cambiati, 0);
});

test("un host già offline non viene riscritto: updated_at non cambia", () => {
  const reteId = withTenant(T, () => preparaRete([{ ip: "10.250.0.3", status: "offline", last_seen: PRIMA }]));
  const cambiati = withTenant(T, () => markHostsOffline(reteId, [], SCANSIONATI, INIZIO));
  assert.deepEqual(stato(reteId), [{ ip: "10.250.0.3", status: "offline", updated_at: VECCHIO_UPDATED }]);
  assert.equal(cambiati, 0);
});

test("un host online non visto dopo l'inizio e che non risponde va offline", () => {
  const reteId = withTenant(T, () =>
    preparaRete([
      { ip: "10.250.0.4", status: "online", last_seen: PRIMA },
      { ip: "10.250.0.5", status: "online", last_seen: null },
    ]),
  );
  const cambiati = withTenant(T, () => markHostsOffline(reteId, [], SCANSIONATI, INIZIO));
  assert.equal(cambiati, 2);
  for (const r of stato(reteId)) {
    assert.equal(r.status, "offline", r.ip);
    assert.notEqual(r.updated_at, VECCHIO_UPDATED, r.ip);
  }
});

test("un host «unknown» che non risponde va offline come prima", () => {
  const reteId = withTenant(T, () => preparaRete([{ ip: "10.250.0.6", status: "unknown", last_seen: null }]));
  const cambiati = withTenant(T, () => markHostsOffline(reteId, [], SCANSIONATI, INIZIO));
  assert.equal(cambiati, 1);
  assert.equal(stato(reteId)[0].status, "offline");
});

test("restano fuori gli IP che hanno risposto e quelli non scansionati", () => {
  const reteId = withTenant(T, () =>
    preparaRete([
      { ip: "10.250.0.1", status: "online", last_seen: PRIMA }, // ha risposto
      { ip: "10.250.0.4", status: "online", last_seen: PRIMA }, // non risponde
      { ip: "10.250.0.5", status: "online", last_seen: PRIMA }, // fuori dagli scansionati
    ]),
  );
  const cambiati = withTenant(T, () =>
    markHostsOffline(reteId, ["10.250.0.1"], ["10.250.0.1", "10.250.0.4"], INIZIO),
  );
  assert.equal(cambiati, 1);
  assert.deepEqual(
    stato(reteId).map((r) => [r.ip, r.status]),
    [
      ["10.250.0.1", "online"],
      ["10.250.0.4", "offline"],
      ["10.250.0.5", "online"],
    ],
  );
});

test("nessun IP scansionato: nessun host cambia (non vale come «tutta la rete»)", () => {
  const reteId = withTenant(T, () => preparaRete([{ ip: "10.250.0.4", status: "online", last_seen: PRIMA }]));
  const cambiati = withTenant(T, () => markHostsOffline(reteId, [], [], INIZIO));
  assert.equal(stato(reteId)[0].status, "online");
  assert.equal(cambiati, 0);
});

test("i candidati letti coincidono con le righe cambiate", () => {
  const righe: RigaFinta[] = [
    { ip: "10.250.0.1", status: "online", last_seen: PRIMA },
    { ip: "10.250.0.2", status: "online", last_seen: DOPO },
    { ip: "10.250.0.3", status: "offline", last_seen: PRIMA },
    { ip: "10.250.0.4", status: "unknown", last_seen: null },
    { ip: "10.250.0.5", status: "online", last_seen: null },
    { ip: "10.250.0.6", status: "online", last_seen: PRIMA },
  ];
  const reteId = withTenant(T, () => preparaRete(righe));
  const online = ["10.250.0.6"];
  const candidati = withTenant(T, () => selectOfflineCandidates(reteId, online, SCANSIONATI, INIZIO));
  assert.deepEqual(
    candidati.map((c) => c.ip),
    ["10.250.0.1", "10.250.0.4", "10.250.0.5"],
  );
  // La lettura non scrive.
  assert.ok(stato(reteId).every((r) => r.updated_at === VECCHIO_UPDATED));

  const cambiati = withTenant(T, () => markHostsOffline(reteId, online, SCANSIONATI, INIZIO));
  assert.equal(cambiati, candidati.length);
  const toccati = stato(reteId)
    .filter((r) => r.updated_at !== VECCHIO_UPDATED)
    .map((r) => r.ip);
  assert.deepEqual(toccati, candidati.map((c) => c.ip));
});

test("un inizio giro che non ha la forma di datetime('now') è rifiutato", () => {
  const reteId = withTenant(T, () => preparaRete([{ ip: "10.250.0.4", status: "online", last_seen: PRIMA }]));
  // La forma ISO col «T» si confronta male come testo con `last_seen`.
  assert.throws(() => withTenant(T, () => markHostsOffline(reteId, [], SCANSIONATI, "2026-10-12T10:00:00.000Z")));
  assert.throws(() => withTenant(T, () => selectOfflineCandidates(reteId, [], SCANSIONATI, "")));
  assert.equal(stato(reteId)[0].status, "online");
});

test("oraDelDatabase ha la stessa forma di last_seen", () => {
  const ora = withTenant(T, () => oraDelDatabase());
  assert.match(ora, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("banco: un host visto vivo durante un giro lento non viene spento da quel giro", async () => {
  // Due host noti, entrambi visti l'ultima volta prima del giro; il doppio non li
  // vede vivi. Durante il giro (trattenuto dal cancello) il controllo degli host
  // noti vede vivo 10.250.0.4: a giro finito deve restare online, mentre
  // 10.250.0.5, che nessuno ha visto, va offline.
  const reteId = withTenant(T, () =>
    preparaRete([
      { ip: "10.250.0.4", status: "online", last_seen: "2026-01-01 00:00:00" },
      { ip: "10.250.0.5", status: "online", last_seen: "2026-01-01 00:00:00" },
    ]),
  );
  let apri!: () => void;
  const cancello = new Promise<void>((r) => {
    apri = r;
  });
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1"], cancello });
  installaEsecutoreFinto(override);

  const avvio = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  await new Promise((r) => setTimeout(r, 30));
  withTenant(T, () => upsertHost({ network_id: reteId, ip: "10.250.0.4", status: "online" }));
  apri();
  const esito = await avvio.done;

  assert.deepEqual(tentativiBloccati, [], "il giro ha provato a uscire sulla rete");
  assert.equal(esito.status, "completed");
  const righe = new Map(stato(reteId).map((r) => [r.ip, r.status]));
  assert.equal(righe.get("10.250.0.4"), "online", "host visto durante il giro spento dal giro vecchio");
  assert.equal(righe.get("10.250.0.5"), "offline");
  assert.equal(righe.get("10.250.0.1"), "online");
});
