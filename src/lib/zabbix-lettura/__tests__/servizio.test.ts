// Pannello Zabbix in sola lettura (passo 7.4-7.5): le prove lato DA-IPAM del §7 del
// design dell'API di DA-Zabbix, con un centro finto che conta le chiamate.
// - non acquistato / da configurare / spento: ZERO richieste;
// - cliente errato: «guasto: cliente errato», nessun dato;
// - abbinamento ambiguo: candidati, niente salvato; proposto → confermato → perso;
// - dati vecchi e proxy fermo: «non so», valori vecchi, mai «tutto ok»;
// - centrale irraggiungibile: guasto con l'ora dell'ultima lettura, attesa crescente.
// DB in memoria: le tabelle del pannello più un `hosts` minimo.
process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { salvaConfigLettura, leggiConfigLettura } from "../config";
import {
  confermaAbbinamento,
  leggiPannello,
  pannelloNelMenu,
  svuotaCachePannello,
  type DipendenzePannello,
} from "../servizio";
import type { PannelloZabbix, ProxyLocale } from "../pannello";
import { CODCLI, centroFinto, hostFinto, statoBase, type StatoCentro } from "./support/centro-finto";
import type { Trasporto } from "../trasporto";

const CHIAVE = `zl1.a1b2c3d4.${"A".repeat(43)}`;
const INIZIO = new Date("2026-10-16T10:00:00Z");

function dbProva(): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE hosts (id INTEGER PRIMARY KEY, network_id INTEGER, ip TEXT NOT NULL, hostname TEXT, custom_name TEXT)");
  return db;
}

let n = 0;
interface Banco {
  d: DipendenzePannello;
  db: Database.Database;
  chiamate: string[];
  stato: StatoCentro;
  orologio: { ora: Date };
  avanti: (s: number) => void;
}

function banco(opz: { acquistato?: boolean; configura?: boolean; acceso?: boolean; stato?: StatoCentro; trasporto?: Trasporto } = {}): Banco {
  const db = dbProva();
  const centro = centroFinto(opz.stato ?? statoBase());
  const orologio = { ora: new Date(INIZIO) };
  if (opz.configura !== false) {
    const r = salvaConfigLettura(
      db,
      { baseUrl: "https://centro.example/wizard", chiave: CHIAVE, codcli: CODCLI, enabled: opz.acceso !== false },
      "prova",
    );
    assert.ok(r.ok);
  }
  const proxy: ProxyLocale = { stato: "gira", nome: `${CODCLI}-zbx` };
  const d: DipendenzePannello = {
    tenant: `PROVA${++n}`,
    db,
    acquistato: () => opz.acquistato !== false,
    trasporto: () => opz.trasporto ?? centro.trasporto,
    proxyLocale: () => proxy,
    adesso: () => orologio.ora,
  };
  return {
    d,
    db,
    chiamate: centro.chiamate,
    stato: centro.stato,
    orologio,
    avanti: (s) => {
      orologio.ora = new Date(orologio.ora.getTime() + s * 1000);
    },
  };
}

function ok(p: PannelloZabbix): Extract<PannelloZabbix, { stato: "ok" }> {
  assert.equal(p.stato, "ok", JSON.stringify(p));
  return p as Extract<PannelloZabbix, { stato: "ok" }>;
}

beforeEach(() => svuotaCachePannello());

// ── Stati senza traffico ─────────────────────────────────────────────────────

test("non acquistato: stato «non_acquistato» e zero richieste al centro (anche se configurato)", async () => {
  const b = banco({ acquistato: false });
  const p = await leggiPannello(b.d);
  assert.equal(p.stato, "non_acquistato");
  assert.equal(b.chiamate.length, 0);
  assert.equal(pannelloNelMenu(b.d), false);
});

test("da configurare: senza indirizzo e chiave zero richieste", async () => {
  const b = banco({ configura: false });
  const p = await leggiPannello(b.d, { forza: true });
  assert.equal(p.stato, "da_configurare");
  assert.equal(b.chiamate.length, 0);
});

test("spento: configurato ma spento, zero richieste anche con «Riprova adesso»", async () => {
  const b = banco({ acceso: false });
  const p = await leggiPannello(b.d, { forza: true });
  assert.equal(p.stato, "spento");
  assert.equal(b.chiamate.length, 0);
  assert.equal(pannelloNelMenu(b.d), false);
});

test("acceso e sano: stato ok, dati del centro, «tutto ok», nel menu", async () => {
  const b = banco();
  const p = ok(await leggiPannello(b.d));
  assert.equal(p.cliente, "ESEMPIO");
  assert.equal(p.totale, 2);
  assert.equal(p.riepilogo.tuttoOk, true, p.riepilogo.motivi.join("; "));
  assert.equal(p.host[0]!.disponibilita, "si");
  assert.equal(p.host[0]!.diQuestaMacchina, true);
  assert.deepEqual(p.host[0]!.valori.map((v) => v.chiave), ["icmppingsec"]);
  assert.equal(pannelloNelMenu(b.d), true);
  // Le richieste portano solo le quattro rotte, sotto la base configurata.
  for (const c of b.chiamate) assert.match(c, /^\/wizard\/api\/lettura\/v1\/(cliente|host|problemi|valori)(\?|$)/);
});

test("una seconda apertura entro 30 s non richiama il centro", async () => {
  const b = banco();
  await leggiPannello(b.d);
  const prima = b.chiamate.length;
  b.avanti(10);
  await leggiPannello(b.d);
  assert.equal(b.chiamate.length, prima);
  b.avanti(31);
  await leggiPannello(b.d);
  assert.ok(b.chiamate.length > prima);
});

// ── Cliente errato ───────────────────────────────────────────────────────────

test("cliente errato: la risposta porta un altro codcli → «guasto: cliente errato», nessun dato", async () => {
  const s = statoBase();
  s.codcliRisposta = "99999";
  const b = banco({ stato: s });
  const p = await leggiPannello(b.d);
  assert.equal(p.stato, "guasto");
  assert.ok(p.stato === "guasto" && p.clienteErrato);
  assert.match(p.stato === "guasto" ? p.messaggio : "", /cliente errato/);
  const testo = JSON.stringify(p);
  for (const vietato of ["ESEMPIO", "Apparato", "192.0.2.", "10001"]) assert.ok(!testo.includes(vietato), vietato);
  // Si è fermato alla prima risposta: nessun'altra rotta letta.
  assert.equal(b.chiamate.length, 1);
  // Durante l'attesa resta «cliente errato», senza richieste.
  const q = await leggiPannello(b.d);
  assert.ok(q.stato === "guasto" && q.clienteErrato);
  assert.equal(b.chiamate.length, 1);
});

test("due aperture insieme a cache scaduta: una lettura sola", async () => {
  const b = banco();
  await Promise.all([leggiPannello(b.d), leggiPannello(b.d)]);
  assert.equal(b.chiamate.filter((c) => c.includes("/cliente")).length, 1);
});

test("cliente errato sui valori dopo una lettura buona: guasto, i dati di prima non restano", async () => {
  const b = banco();
  ok(await leggiPannello(b.d));
  b.avanti(31);
  // Il centro cambia cliente fra una lettura e l'altra (chiave scambiata).
  b.stato.codcliRisposta = "99999";
  const p = await leggiPannello(b.d);
  assert.equal(p.stato, "guasto");
  assert.ok(!JSON.stringify(p).includes("Apparato"));
  // E una conferma d'abbinamento non si appoggia più alla lettura di prima.
  const c = confermaAbbinamento(b.d, { hostid: "10001", hostId: 1 }, "prova");
  assert.equal(c.ok, false);
});

// ── Abbinamento ──────────────────────────────────────────────────────────────

test("ambiguo: due host del centro con lo stesso IP → candidati, niente salvato, conferma rifiutata", async () => {
  const s = statoBase();
  s.host = [
    hostFinto(10001, "192.0.2.20", { ip_condiviso: true, proxy: "12345-zbx" }),
    hostFinto(10002, "192.0.2.20", { ip_condiviso: true, proxy: "12345-zbx-sede2" }),
  ];
  const b = banco({ stato: s });
  b.db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (1, 1, '192.0.2.20', 'apparato-10001')").run();
  const p = ok(await leggiPannello(b.d));
  for (const h of p.host) {
    assert.equal(h.abbinamento.stato, "ambiguo");
    if (h.abbinamento.stato === "ambiguo") {
      assert.deepEqual(h.abbinamento.candidatiCentro.map((c) => c.hostid).sort(), ["10001", "10002"]);
      assert.deepEqual(h.abbinamento.candidatiCentro.map((c) => c.proxy).sort(), ["12345-zbx", "12345-zbx-sede2"]);
    }
  }
  const c = confermaAbbinamento(b.d, { hostid: "10001", hostId: 1 }, "prova");
  assert.equal(c.ok, false);
  assert.equal((b.db.prepare("SELECT COUNT(*) AS n FROM zabbix_abbinamenti").get() as { n: number }).n, 0);
});

test("ambiguo anche quando lo stesso IP sta su due host di DA-IPAM", async () => {
  const b = banco();
  b.db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (1, 1, '192.0.2.10', 'a'), (2, 2, '192.0.2.10', 'b')").run();
  const p = ok(await leggiPannello(b.d));
  const h = p.host.find((x) => x.hostid === "10001")!;
  assert.equal(h.abbinamento.stato, "ambiguo");
  assert.ok(h.abbinamento.stato === "ambiguo" && h.abbinamento.motivo === "ip_doppio_in_ipam");
});

test("proposto → confermato da una persona → verificato; IP cambiato → perso; hostid sparito → fra i persi", async () => {
  const b = banco();
  b.db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (7, 1, '192.0.2.10', 'apparato-10001.esempio.lan')").run();
  let p = ok(await leggiPannello(b.d));
  let h = p.host.find((x) => x.hostid === "10001")!;
  assert.equal(h.abbinamento.stato, "proposto");
  assert.ok(h.abbinamento.stato === "proposto" && h.abbinamento.nomeCoincide);
  // Proposto non è salvato.
  assert.equal((b.db.prepare("SELECT COUNT(*) AS n FROM zabbix_abbinamenti").get() as { n: number }).n, 0);
  // Conferma con l'host sbagliato: rifiutata.
  assert.equal(confermaAbbinamento(b.d, { hostid: "10001", hostId: 8 }, "prova").ok, false);
  assert.deepEqual(confermaAbbinamento(b.d, { hostid: "10001", hostId: 7 }, "prova"), { ok: true });

  b.avanti(31);
  p = ok(await leggiPannello(b.d));
  h = p.host.find((x) => x.hostid === "10001")!;
  assert.equal(h.abbinamento.stato, "verificato");

  // Il centro ora dice un altro IP per quell'host: perso, non riabbinato a nessuno.
  b.stato.host[0] = hostFinto(10001, "192.0.2.99");
  b.db.prepare("INSERT INTO hosts (id, network_id, ip, hostname) VALUES (9, 1, '192.0.2.99', 'altro')").run();
  b.avanti(31);
  p = ok(await leggiPannello(b.d));
  h = p.host.find((x) => x.hostid === "10001")!;
  assert.equal(h.abbinamento.stato, "perso");

  // L'hostid non torna più: fra i persi, con l'host di DA-IPAM.
  b.stato.host = b.stato.host.filter((x) => x.hostid !== "10001");
  b.avanti(31);
  p = ok(await leggiPannello(b.d));
  assert.deepEqual(p.persi.map((x) => [x.hostid, x.hostId]), [["10001", 7]]);
});

// ── Dati vecchi ──────────────────────────────────────────────────────────────

test("dati vecchi: vecchio=true ed eta_s alto → disponibilità «non so», valori vecchi, niente «tutto ok»", async () => {
  const s = statoBase();
  s.vecchio = true;
  s.eta_s = 840;
  const b = banco({ stato: s });
  const p = ok(await leggiPannello(b.d));
  assert.equal(p.vecchio, true);
  for (const h of p.host) {
    assert.equal(h.disponibilita, "non_so");
    assert.equal(h.disponibilitaUltimaNota, "si");
    assert.equal(h.datiAffidabili, false);
  }
  assert.ok(p.host[0]!.valori.every((v) => v.vecchio));
  assert.equal(p.riepilogo.tuttoOk, false);
  assert.ok(p.riepilogo.motivi.some((m) => /dati vecchi di 14 minuti/.test(m)), p.riepilogo.motivi.join("; "));
});

test("proxy fuori linea: host con dati non affidabili → «non so», niente «tutto ok»", async () => {
  const s = statoBase();
  s.proxy = [{ nome: "12345-zbx", in_linea: false, ultimo_contatto: "2026-10-16T09:40:00Z" }];
  s.host = s.host.map((h) => ({ ...h, dati_affidabili: false }));
  const b = banco({ stato: s });
  const p = ok(await leggiPannello(b.d));
  assert.ok(p.host.every((h) => h.disponibilita === "non_so"));
  assert.equal(p.proxyCentro[0]!.inLinea, false);
  assert.equal(p.proxyCentro[0]!.diQuestaMacchina, true);
  assert.equal(p.riepilogo.tuttoOk, false);
  assert.ok(p.riepilogo.motivi.some((m) => m.includes("proxy fuori linea")));
});

test("un campo dati_affidabili assente vale «non affidabile», mai «sì»", async () => {
  const s = statoBase();
  delete s.host[0]!.dati_affidabili;
  const b = banco({ stato: s });
  const p = ok(await leggiPannello(b.d));
  assert.equal(p.host.find((h) => h.hostid === "10001")!.disponibilita, "non_so");
  assert.equal(p.riepilogo.tuttoOk, false);
});

// ── Centrale irraggiungibile ─────────────────────────────────────────────────

test("irraggiungibile: guasto con l'ora dell'ultima lettura buona, attesa crescente fino a 5 minuti", async () => {
  const b = banco();
  ok(await leggiPannello(b.d));
  const ultimaBuona = leggiConfigLettura(b.db)!.ultimaLetturaOk;
  assert.ok(ultimaBuona);

  b.stato.guasto = "tempo";
  const attese: number[] = [];
  for (let i = 0; i < 7; i++) {
    b.avanti(31); // oltre la cache
    const p = await leggiPannello(b.d);
    // Durante l'attesa nessuna richiesta: si aspetta la scadenza.
    if (p.stato !== "guasto") assert.fail(`atteso guasto, visto ${p.stato}`);
    assert.equal(p.ultimaLetturaOk, ultimaBuona);
    assert.ok(!JSON.stringify(p).includes("Apparato"), "nessun dato durante il guasto");
    const prossimo = new Date(p.prossimoTentativo!).getTime();
    const attesa = Math.round((prossimo - b.orologio.ora.getTime()) / 1000);
    attese.push(attesa);
    const chiamatePrima = b.chiamate.length;
    b.avanti(Math.max(0, attesa - 31) + 0); // ancora dentro l'attesa…
    if (attesa > 31) {
      const q = await leggiPannello(b.d);
      assert.equal(q.stato, "guasto");
      assert.equal(b.chiamate.length, chiamatePrima, "nessuna richiesta prima della scadenza");
    }
    b.orologio.ora = new Date(prossimo); // …poi scade
  }
  assert.deepEqual(attese, [15, 30, 60, 120, 240, 300, 300]);
});

test("502 «zabbix_non_risponde» e 503 «api_spenta»: guasto con testo nostro; 429 rispetta Retry-After", async () => {
  const b = banco();
  b.stato.guasto = { status: 502, codice: "zabbix_non_risponde" };
  let p = await leggiPannello(b.d);
  assert.ok(p.stato === "guasto" && /Zabbix del centro non risponde/.test(p.messaggio));

  b.stato.guasto = { status: 503, codice: "api_spenta" };
  p = await leggiPannello(b.d, { forza: true });
  assert.ok(p.stato === "guasto" && /spenta sul centro/.test(p.messaggio));

  b.stato.guasto = { status: 429, codice: "troppe_richieste", retryAfter: "200" };
  p = await leggiPannello(b.d, { forza: true });
  assert.ok(p.stato === "guasto");
  const attesa = (new Date(p.prossimoTentativo!).getTime() - b.orologio.ora.getTime()) / 1000;
  assert.equal(attesa, 200);
});

test("«Riprova adesso» ignora l'attesa; una lettura buona azzera i fallimenti", async () => {
  const b = banco();
  b.stato.guasto = "rete";
  assert.equal((await leggiPannello(b.d)).stato, "guasto");
  b.stato.guasto = null;
  // Senza forza, ancora in attesa.
  const prima = b.chiamate.length;
  assert.equal((await leggiPannello(b.d)).stato, "guasto");
  assert.equal(b.chiamate.length, prima);
  ok(await leggiPannello(b.d, { forza: true }));
  const cfg = leggiConfigLettura(b.db)!;
  assert.equal(cfg.fallimenti, 0);
  assert.equal(cfg.prossimoTentativo, null);
});

test("elenco host su più pagine: letto per intero, poi paginato a 50 per la pagina", async () => {
  const s = statoBase();
  s.limitePagina = 40;
  s.host = Array.from({ length: 120 }, (_, i) => hostFinto(20000 + i, `192.0.2.${i + 1}`));
  const b = banco({ stato: s });
  const p = ok(await leggiPannello(b.d, { pagina: 3 }));
  assert.equal(p.totale, 120);
  assert.equal(p.host.length, 20);
  assert.equal(p.host[0]!.hostid, "20100");
  assert.equal(b.chiamate.filter((c) => c.includes("/host?")).length, 3);
  // I valori si chiedono solo per la pagina mostrata.
  const valori = b.chiamate.find((c) => c.includes("/valori?"))!;
  assert.equal(new URL(valori, "https://x.invalid").searchParams.get("hostid")!.split(",").length, 20);
});

test("solo gli host del proxy di questa macchina, se richiesto", async () => {
  const s = statoBase();
  s.host = [hostFinto(10001, "192.0.2.10"), hostFinto(10002, "192.0.2.11", { proxy: "12345-zbx-sede2" })];
  const b = banco({ stato: s });
  const tutti = ok(await leggiPannello(b.d));
  assert.equal(tutti.totale, 2);
  const miei = ok(await leggiPannello(b.d, { soloQuestaMacchina: true }));
  assert.deepEqual(miei.host.map((h) => h.hostid), ["10001"]);
});
