/**
 * Sonde integrate con DA-Link (spec DA-Vul-can 2026-10-20, §8.2): il blocco `edge` del
 * segnale è lo stato che la sonda locale dichiara su `/api/v1/health` (§8.1), copiato a
 * LISTA BIANCA. DA-IPAM non interpreta: copia i campi del contratto e basta.
 *
 * - campi in più della sonda (anche quelli di sempre: `scanner_id` è il nome dell'istanza,
 *   può contenere il nome del cliente) non escono;
 * - un valore fuori dall'elenco chiuso diventa null, mai un testo libero: un motivo come
 *   «connection refused to 10.0.0.1» porterebbe a Domarc un indirizzo della rete del cliente;
 * - la sonda vecchia (solo `ok`/`version`) risponde ma non dichiara niente: raggiungibile,
 *   tutto il resto null; `version` non diventa `versione_vera` (è il pyproject: PX-NAS
 *   dichiarava 0.1.0, diagnosi del 19/10);
 * - sonda che non risponde, o che risponde con qualcosa che non è un oggetto JSON:
 *   `raggiungibile: false`, gli altri campi null (un errore di trasporto non è un «ok»).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgePerSegnale } from "../edge-segnale";

/** La risposta vera di `/api/v1/health` della 0.8.121 (routes/api_v1.py + stato_sonda.py). */
const HEALTH_VERA = {
  ok: true,
  version: "0.8.121",
  scanner_id: "70791-cliente-edge",
  sealed_mode: false,
  tls_active: true,
  versione_vera: "0.8.121",
  hub: {
    esito: "errore",
    motivo: "dns",
    ultimo_battito_il: "2026-10-20T08:00:00Z",
    ultimo_ok_il: "2026-10-19T22:00:00Z",
    ultimo_errore_il: "2026-10-20T08:00:00Z",
    ultimo_errore_motivo: "dns",
    errori_consecutivi: 3,
  },
  aggiornamento: {
    esito: "riuscito",
    fase: "fine",
    commit_avviato: "0.8.121",
    commit_tentato: "0.8.121",
    tentativi: 1,
    tentativo_iniziato_il: "2026-10-20T01:12:00Z",
    tentativo_finito_il: "2026-10-20T01:15:30Z",
    ultimo_successo_il: "2026-10-20T01:15:30Z",
    ultimo_controllo: "avviato",
    ultimo_controllo_il: "2026-10-20T01:12:00Z",
    controllo_motivo: null,
    modalita: "container",
  },
  disco: { total_gb: 77.0, free_gb: 37.2 },
};

const CHIAVI_EDGE = ["aggiornamento", "disco", "hub", "raggiungibile", "versione_vera"];
const CHIAVI_HUB = [
  "errori_consecutivi",
  "esito",
  "motivo",
  "ultimo_battito_il",
  "ultimo_errore_il",
  "ultimo_errore_motivo",
  "ultimo_ok_il",
];
const CHIAVI_AGG = [
  "commit_avviato",
  "commit_tentato",
  "controllo_motivo",
  "esito",
  "fase",
  "modalita",
  "tentativi",
  "tentativo_finito_il",
  "tentativo_iniziato_il",
  "ultimo_controllo",
  "ultimo_controllo_il",
  "ultimo_successo_il",
];

test("forma vera della 0.8.121: i campi del contratto escono uguali, gli altri no", () => {
  const e = edgePerSegnale({ raggiungibile: true, health: HEALTH_VERA });
  assert.deepEqual(e, {
    raggiungibile: true,
    versione_vera: "0.8.121",
    hub: HEALTH_VERA.hub,
    aggiornamento: HEALTH_VERA.aggiornamento,
    disco: { total_gb: 77.0, free_gb: 37.2 },
  });
  const testo = JSON.stringify(e);
  assert.ok(!testo.includes("scanner_id") && !testo.includes("70791-cliente-edge"), "il nome dell'istanza non esce");
  assert.ok(!testo.includes("sealed_mode") && !testo.includes("tls_active"));
});

test("campi in più a ogni livello: scartati, le chiavi sono solo quelle del contratto", () => {
  const storta = {
    ...HEALTH_VERA,
    gettone: "segreto-della-sonda",
    hub: { ...HEALTH_VERA.hub, messaggio: "getaddrinfo failed for da-vulcan.domarc.it", url: "https://10.0.0.5" },
    aggiornamento: { ...HEALTH_VERA.aggiornamento, log: "/var/lib/scanner-edge/x.log", commit: "abc" },
    disco: { ...HEALTH_VERA.disco, percorso: "/var/lib/scanner-edge" },
  };
  const e = edgePerSegnale({ raggiungibile: true, health: storta });
  assert.deepEqual(Object.keys(e).sort(), CHIAVI_EDGE);
  assert.deepEqual(Object.keys(e.hub ?? {}).sort(), CHIAVI_HUB);
  assert.deepEqual(Object.keys(e.aggiornamento ?? {}).sort(), CHIAVI_AGG);
  assert.deepEqual(Object.keys(e.disco ?? {}).sort(), ["free_gb", "total_gb"]);
  const testo = JSON.stringify(e);
  for (const v of ["segreto", "getaddrinfo", "10.0.0.5", "/var/lib"]) assert.ok(!testo.includes(v), `${v} non deve uscire`);
});

test("valori fuori dall'elenco chiuso → null, mai il testo che è arrivato", () => {
  const storta = {
    versione_vera: "0.8.121; rm -rf /",
    hub: {
      esito: "ok!",
      motivo: "connection refused to 10.0.0.1",
      ultimo_battito_il: "ieri alle 8, errore TLS su 10.0.0.1",
      ultimo_ok_il: 1729411200,
      ultimo_errore_il: "2026-10-20T08:00:00Z e poi un messaggio",
      ultimo_errore_motivo: "DNS",
      errori_consecutivi: -1,
    },
    aggiornamento: {
      esito: "ok",
      fase: "compilazione",
      commit_avviato: "0.8.121 (build di /home/x)",
      commit_tentato: 120,
      tentativi: "3",
      tentativo_iniziato_il: null,
      tentativo_finito_il: "",
      ultimo_successo_il: true,
      ultimo_controllo: "errore: disco pieno su /dev/sda1",
      ultimo_controllo_il: "2026-10-20",
      controllo_motivo: "timeout",
      modalita: "auto",
    },
    disco: { total_gb: "77", free_gb: -5 },
  };
  const e = edgePerSegnale({ raggiungibile: true, health: storta });
  assert.equal(e.raggiungibile, true);
  assert.equal(e.versione_vera, null);
  assert.deepEqual(e.hub, Object.fromEntries(CHIAVI_HUB.map((k) => [k, null])));
  assert.deepEqual(e.aggiornamento, Object.fromEntries(CHIAVI_AGG.map((k) => [k, null])));
  assert.equal(e.disco, null, "disco senza nessun numero valido: null, mai zeri inventati");
});

test("ogni valore degli elenchi della §8.1 passa", () => {
  for (const motivo of ["dns", "tls", "401", "http", "rete", "configurazione"]) {
    const e = edgePerSegnale({
      raggiungibile: true,
      health: { hub: { esito: "errore", motivo, ultimo_errore_motivo: motivo }, aggiornamento: { controllo_motivo: motivo } },
    });
    assert.equal(e.hub?.motivo, motivo);
    assert.equal(e.hub?.ultimo_errore_motivo, motivo);
    assert.equal(e.aggiornamento?.controllo_motivo, motivo);
  }
  for (const esito of ["riuscito", "fallito", "interrotto", "in_corso"]) {
    assert.equal(edgePerSegnale({ raggiungibile: true, health: { aggiornamento: { esito } } }).aggiornamento?.esito, esito);
  }
  for (const fase of ["scarica", "verifica", "prepara", "scambio", "riavvio", "salute", "ritorno", "avvio", "fine"]) {
    assert.equal(edgePerSegnale({ raggiungibile: true, health: { aggiornamento: { fase } } }).aggiornamento?.fase, fase);
  }
  const controlli = [
    "gia_aggiornato",
    "attesa_versione",
    "avviato",
    "hub_non_raggiungibile",
    "hub_non_configurato",
    "manifesto_non_valido",
    "spazio_insufficiente",
    "tentativi_esauriti",
    "spento",
  ];
  for (const c of controlli) {
    assert.equal(edgePerSegnale({ raggiungibile: true, health: { aggiornamento: { ultimo_controllo: c } } }).aggiornamento?.ultimo_controllo, c);
  }
  for (const m of ["standalone", "container"]) {
    assert.equal(edgePerSegnale({ raggiungibile: true, health: { aggiornamento: { modalita: m } } }).aggiornamento?.modalita, m);
  }
  assert.equal(edgePerSegnale({ raggiungibile: true, health: { hub: { esito: "ok" } } }).hub?.esito, "ok");
});

test("stringhe ai limiti di DA-Link: versioni a 64, date a 40", () => {
  const lunga = "1".repeat(200);
  const e = edgePerSegnale({
    raggiungibile: true,
    health: { versione_vera: lunga, aggiornamento: { commit_avviato: lunga, commit_tentato: lunga } },
  });
  assert.equal(e.versione_vera?.length, 64);
  assert.equal(e.aggiornamento?.commit_avviato?.length, 64);
  assert.equal(e.aggiornamento?.commit_tentato?.length, 64);
  const data = edgePerSegnale({ raggiungibile: true, health: { hub: { ultimo_ok_il: "2026-10-20T08:00:00.123456+02:00" } } });
  assert.equal(data.hub?.ultimo_ok_il, "2026-10-20T08:00:00.123456+02:00");
});

test("sonda vecchia (solo ok/version): raggiungibile, il resto null, `version` non è la versione vera", () => {
  const e = edgePerSegnale({
    raggiungibile: true,
    health: { ok: true, version: "0.1.0", scanner_id: "x", sealed_mode: false, tls_enabled: true },
  });
  assert.deepEqual(e, { raggiungibile: true, versione_vera: null, hub: null, aggiornamento: null, disco: null });
});

test("sonda che non risponde: raggiungibile false e gli altri campi null", () => {
  assert.deepEqual(edgePerSegnale({ raggiungibile: false }), {
    raggiungibile: false,
    versione_vera: null,
    hub: null,
    aggiornamento: null,
    disco: null,
  });
});

test("risposta che non è un oggetto JSON: non è la sonda, raggiungibile false", () => {
  for (const health of [null, [], "ok", 42, true, [HEALTH_VERA]]) {
    assert.deepEqual(
      edgePerSegnale({ raggiungibile: true, health }),
      { raggiungibile: false, versione_vera: null, hub: null, aggiornamento: null, disco: null },
      `health=${JSON.stringify(health)}`,
    );
  }
});

test("blocchi annidati che non sono oggetti → null; disco parziale tiene il numero valido", () => {
  const e = edgePerSegnale({
    raggiungibile: true,
    health: { hub: "errore dns", aggiornamento: ["riuscito"], disco: { total_gb: 77, free_gb: Number.NaN } },
  });
  assert.equal(e.hub, null);
  assert.equal(e.aggiornamento, null);
  assert.deepEqual(e.disco, { total_gb: 77, free_gb: null });
});
