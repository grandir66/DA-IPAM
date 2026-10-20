/**
 * Selezione degli host da archiviare (pulizia degli host assenti, piano 2026-10-20, Task 2).
 * Decisioni di Riccardo del 20/10: (1) offline da oltre 60 giorni → archivio; (3) stesso MAC,
 * IP cambiato → il vecchio IP subito, ma solo se nel gruppo del MAC c'è UN solo host online,
 * visto dopo il vecchio. Zona rossa: decide quali host del cliente spariscono. Solo `offline`
 * è candidato; le date sono nel formato di SQLite (UTC senza fuso) e si leggono con `parseDbDate`.
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIORNI_ASSENZA_ARCHIVIO, selezionaCandidati, type HostPerPulizia } from "@/lib/hosts/pulizia";

const ADESSO = new Date("2026-10-20T10:00:00Z");
const GIORNO = 86_400_000;

/** Una data `giorni` prima di ADESSO, scritta come la scrive SQLite (`datetime('now')`). */
function fa(giorni: number): string {
  return new Date(ADESSO.getTime() - giorni * GIORNO).toISOString().slice(0, 19).replace("T", " ");
}

let prossimo = 0;
function h(campi: Partial<HostPerPulizia> & { ip: string }): HostPerPulizia {
  prossimo += 1;
  return {
    id: prossimo, mac: null, nome: campi.ip, status: "offline",
    lastSeen: null, firstSeen: null, createdAt: null, escluso: null, ...campi,
  };
}

const idCandidati = (host: HostPerPulizia[]) => selezionaCandidati(host, ADESSO).candidati.map((c) => c.id);

test("la soglia è 60 giorni", () => {
  assert.equal(GIORNI_ASSENZA_ARCHIVIO, 60);
});

test("offline da 61 giorni → candidato «assente da 61 giorni»; da 59 no", () => {
  const vecchio = h({ ip: "10.0.1.34", nome: "PC-RECEPTION", mac: "AA:BB:CC:00:11:22", lastSeen: fa(61) });
  const recente = h({ ip: "10.0.1.35", lastSeen: fa(59) });
  const esito = selezionaCandidati([vecchio, recente], ADESSO);
  assert.deepEqual(esito.candidati, [{
    id: vecchio.id, ip: "10.0.1.34", mac: "AA:BB:CC:00:11:22", nome: "PC-RECEPTION",
    ultimaVista: fa(61), motivo: "assente", dettaglio: "assente da 61 giorni",
  }]);
  assert.deepEqual(esito.esclusi, []);
});

test("online e unknown non sono mai candidati, nemmeno a 200 giorni", () => {
  assert.deepEqual(idCandidati([
    h({ ip: "10.0.2.1", status: "online", lastSeen: fa(200) }),
    h({ ip: "10.0.2.2", status: "unknown", lastSeen: fa(200) }),
  ]), []);
});

test("mai visto: vale first_seen (70 g → sì, 10 g → no), poi created_at; tutte nulle → no", () => {
  const primo70 = h({ ip: "10.0.3.1", firstSeen: fa(70), createdAt: fa(1) });
  const primo10 = h({ ip: "10.0.3.2", firstSeen: fa(10), createdAt: fa(300) });
  const creato90 = h({ ip: "10.0.3.3", createdAt: fa(90) });
  const creatoIeri = h({ ip: "10.0.3.4", createdAt: fa(1) });
  const senzaDate = h({ ip: "10.0.3.5" });
  const esito = selezionaCandidati([primo70, primo10, creato90, creatoIeri, senzaDate], ADESSO);
  assert.deepEqual(esito.candidati.map((c) => [c.id, c.dettaglio, c.ultimaVista]), [
    [primo70.id, "assente da 70 giorni", null],
    [creato90.id, "assente da 90 giorni", null],
  ]);
});

test("una data che non si legge non fa candidato (niente NaN che passa per vecchio)", () => {
  assert.deepEqual(idCandidati([h({ ip: "10.0.3.9", lastSeen: "non è una data" }), h({ ip: "10.0.3.10", lastSeen: "" })]), []);
});

test("le date SQLite sono UTC: a 60 giorni e un'ora sì, a 60 giorni meno un'ora no", () => {
  // Il fuso lo fissa la prova (e lo rimette com'era): in UTC `new Date(x)` darebbe lo stesso risultato
  // di `parseDbDate` e la prova passerebbe anche col difetto; a Roma (+1/+2) no.
  const fusoPrima = process.env.TZ;
  process.env.TZ = "Europe/Rome";
  try {
    const oltre = h({ ip: "10.0.4.1", lastSeen: new Date(ADESSO.getTime() - 60 * GIORNO - 3_600_000).toISOString().slice(0, 19).replace("T", " ") });
    const dentro = h({ ip: "10.0.4.2", lastSeen: new Date(ADESSO.getTime() - 60 * GIORNO + 3_600_000).toISOString().slice(0, 19).replace("T", " ") });
    assert.deepEqual(idCandidati([oltre, dentro]), [oltre.id]);
  } finally {
    if (fusoPrima === undefined) delete process.env.TZ;
    else process.env.TZ = fusoPrima;
  }
});

test("cambio IP: un online e un offline più vecchio con lo stesso MAC → candidato anche a 2 giorni", () => {
  const nuovo = h({ ip: "10.0.1.81", mac: "AA:BB:CC:00:11:99", status: "online", lastSeen: fa(0) });
  const vecchio = h({ ip: "10.0.1.80", mac: "AA:BB:CC:00:11:99", lastSeen: fa(2) });
  const esito = selezionaCandidati([nuovo, vecchio], ADESSO);
  assert.deepEqual(esito.candidati, [{
    id: vecchio.id, ip: "10.0.1.80", mac: "AA:BB:CC:00:11:99", nome: "10.0.1.80",
    ultimaVista: fa(2), motivo: "cambio_ip", dettaglio: "ora 10.0.1.81",
  }]);
});

test("cambio IP: l'offline visto DOPO l'online non si tocca", () => {
  const online = h({ ip: "10.0.5.2", mac: "AA:BB:CC:00:22:01", status: "online", lastSeen: fa(3) });
  const offline = h({ ip: "10.0.5.1", mac: "AA:BB:CC:00:22:01", lastSeen: fa(1) });
  assert.deepEqual(idCandidati([online, offline]), []);
});

test("gruppo con due online (router, firewall, multihomed): nessuno, nemmeno l'offline", () => {
  const mac = "AA:BB:CC:00:33:01";
  assert.deepEqual(idCandidati([
    h({ ip: "10.0.6.1", mac, status: "online", lastSeen: fa(0) }),
    h({ ip: "10.0.7.1", mac, status: "online", lastSeen: fa(0) }),
    h({ ip: "10.0.8.1", mac, lastSeen: fa(5) }),
  ]), []);
});

test("gruppo tutto offline: vale solo la regola dei 60 giorni", () => {
  const mac = "AA:BB:CC:00:44:01";
  const vecchio = h({ ip: "10.0.9.1", mac, lastSeen: fa(100) });
  const recente = h({ ip: "10.0.9.2", mac, lastSeen: fa(10) });
  const esito = selezionaCandidati([vecchio, recente], ADESSO);
  assert.deepEqual(esito.candidati.map((c) => [c.id, c.motivo]), [[vecchio.id, "assente"]]);
});

test("candidato per le due regole: compare una volta, come cambio IP", () => {
  const mac = "AA:BB:CC:00:55:01";
  const online = h({ ip: "10.0.10.2", mac, status: "online", lastSeen: fa(0) });
  const vecchio = h({ ip: "10.0.10.1", mac, lastSeen: fa(100) });
  const esito = selezionaCandidati([online, vecchio], ADESSO);
  assert.deepEqual(esito.candidati.map((c) => [c.id, c.motivo, c.dettaglio]), [[vecchio.id, "cambio_ip", "ora 10.0.10.2"]]);
});

test("MAC 00:00:00:00:00:00, vuoto o corto non fanno gruppo", () => {
  for (const mac of ["00:00:00:00:00:00", "", "  ", "AB:CD", "00-00-00-00-00-00"]) {
    const online = h({ ip: "10.0.11.2", mac, status: "online", lastSeen: fa(0) });
    const offline = h({ ip: "10.0.11.1", mac, lastSeen: fa(2) });
    assert.deepEqual(idCandidati([online, offline]), [], `MAC ${JSON.stringify(mac)}`);
  }
});

test("MAC scritti aa-bb-… e AA:BB:… sono lo stesso gruppo", () => {
  const online = h({ ip: "10.0.12.2", mac: "AA:BB:CC:00:66:0F", status: "online", lastSeen: fa(0) });
  const offline = h({ ip: "10.0.12.1", mac: "aa-bb-cc-00-66-0f", lastSeen: fa(2) });
  assert.deepEqual(idCandidati([online, offline]), [offline.id]);
});

test("stesso MAC e stesso IP (un'altra rete): non è un cambio IP, resta alla regola dei 60 giorni", () => {
  const mac = "AA:BB:CC:00:77:01";
  const online = h({ ip: "10.0.13.1", mac, status: "online", lastSeen: fa(0) });
  const doppione = h({ ip: "10.0.13.1", mac, lastSeen: fa(2) });
  assert.deepEqual(idCandidati([online, doppione]), []);
});

test("cambio IP con una data mancante (dell'offline o dell'online): non si archivia subito", () => {
  const mac = "AA:BB:CC:00:88:01";
  assert.deepEqual(idCandidati([
    h({ ip: "10.0.14.2", mac, status: "online", lastSeen: fa(0) }),
    h({ ip: "10.0.14.1", mac, lastSeen: null, firstSeen: fa(2) }),
  ]), []);
  const mac2 = "AA:BB:CC:00:88:02";
  assert.deepEqual(idCandidati([
    h({ ip: "10.0.15.2", mac: mac2, status: "online", lastSeen: null }),
    h({ ip: "10.0.15.1", mac: mac2, lastSeen: fa(2) }),
  ]), []);
});

test("gli esclusi: solo gli offline che una regola avrebbe preso, col perché", () => {
  const mac = "AA:BB:CC:00:99:01";
  const apparato = h({ ip: "10.0.16.1", nome: "sw-core", lastSeen: fa(100), escluso: "apparato" });
  const credRecente = h({ ip: "10.0.16.2", lastSeen: fa(10), escluso: "credenziali" });
  const onlineEscluso = h({ ip: "10.0.16.3", mac, status: "online", lastSeen: fa(0), escluso: "monitorato" });
  const vecchioIpEscluso = h({ ip: "10.0.16.4", mac, lastSeen: fa(2), escluso: "asset" });
  const libero = h({ ip: "10.0.16.5", lastSeen: fa(100) });
  const esito = selezionaCandidati([apparato, credRecente, onlineEscluso, vecchioIpEscluso, libero], ADESSO);
  assert.deepEqual(esito.candidati.map((c) => c.id), [libero.id]);
  assert.deepEqual(esito.esclusi, [
    { id: apparato.id, ip: "10.0.16.1", nome: "sw-core", perche: "apparato" },
    { id: vecchioIpEscluso.id, ip: "10.0.16.4", nome: "10.0.16.4", perche: "asset" },
  ]);
});

test("ordine: motivo, poi IP numerico (10.0.0.9 prima di 10.0.0.10)", () => {
  const mac = "AA:BB:CC:00:AA:01";
  const lista = [
    h({ ip: "10.0.0.10", lastSeen: fa(100) }),
    h({ ip: "10.0.20.5", mac, lastSeen: fa(2) }),
    h({ ip: "10.0.20.6", mac, status: "online", lastSeen: fa(0) }),
    h({ ip: "10.0.0.9", lastSeen: fa(100) }),
    h({ ip: "9.1.1.1", lastSeen: fa(100) }),
  ];
  assert.deepEqual(selezionaCandidati(lista, ADESSO).candidati.map((c) => [c.motivo, c.ip]), [
    ["assente", "9.1.1.1"], ["assente", "10.0.0.9"], ["assente", "10.0.0.10"], ["cambio_ip", "10.0.20.5"],
  ]);
});
