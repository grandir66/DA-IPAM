// T3-21 (INV-2): soglia di sicurezza sul passaggio a offline, con conferma per
// intersezione.
//
// Prima di questa correzione un giro che non vedeva nessuno (un ping che non
// esce, un apparato in mezzo che filtra, un esecutore remoto che risponde male)
// mandava offline in un colpo tutti gli host della rete. Ora un giro che
// spegnerebbe più della soglia degli host attivi della rete (predefinita: più
// della metà, almeno 5) in modo `applica` non scrive e lo dice; il giro dopo
// manda offline solo gli host candidati in tutti e due i giri (intersezione),
// così la guardia non resta bloccata per sempre. In modo `registra`
// (predefinito) si applica come prima e si scrive «qui avrei bloccato X»: il
// freno si toglie contando quelle righe.
//
// I candidati in sospeso stanno in `tenant_settings`: un riavvio per
// aggiornamento non azzera la conferma.
//
// Lanciare con
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/offline-guard.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { tentativiBloccati, togliGuardiaRete } from "@/lib/scanner/__tests__/support/guardia-rete";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { discoverNetwork } from "@/lib/scanner/discovery";
import {
  chiaveInSospeso,
  decidiPassaggioOffline,
  impostazioniDa,
  IMPOSTAZIONI_PREDEFINITE,
  leggiInSospeso,
  passaggioOfflineConSoglia,
  type ImpostazioniSogliaOffline,
} from "@/lib/scanner/offline-guard";
import {
  creaEsecutoreFinto,
  installaEsecutoreFinto,
  togliEsecutoreFinto,
} from "@/lib/scanner/__tests__/support/esecutore-finto";

const T = "TESTSOGLIAOFFLINE";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Soglia offline",
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

const VECCHIO = "2026-01-01 00:00:00";
const ip = (n: number) => `10.251.0.${n}`;
const da = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => ip(a + i));

/** Rete /28 (14 indirizzi) con gli host indicati, visti l'ultima volta prima del giro. */
function preparaRete(host: Array<{ ip: string; status: "online" | "offline" | "unknown" }>): number {
  const d = db();
  const id = Number(
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.251.0.0/28', 'soglia')").run().lastInsertRowid,
  );
  const ins = d.prepare("INSERT INTO hosts (network_id, ip, status, last_seen, updated_at) VALUES (?, ?, ?, ?, ?)");
  for (const h of host) ins.run(id, h.ip, h.status, VECCHIO, VECCHIO);
  return id;
}

function impostazione(chiave: string, valore: string): void {
  db()
    .prepare(
      `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(chiave, valore);
}

function statoHost(reteId: number): Map<string, string> {
  const righe = db().prepare("SELECT ip, status FROM hosts WHERE network_id = ?").all(reteId) as Array<{
    ip: string;
    status: string;
  }>;
  return new Map(righe.map((r) => [r.ip, r.status]));
}

function offline(reteId: number): string[] {
  return [...statoHost(reteId)].filter(([, s]) => s === "offline").map(([i]) => i).sort();
}

function ultimaStoria(reteId: number): string {
  const r = db()
    .prepare("SELECT status FROM scan_history WHERE network_id = ? AND host_id IS NULL ORDER BY id DESC LIMIT 1")
    .get(reteId) as { status: string } | undefined;
  return r?.status ?? "";
}

/** Un giro «ping» sul banco: solo gli IP in `vivi` rispondono. */
async function giro(reteId: number, vivi: string[]): Promise<{ status: string; logs: string[] }> {
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi }).override);
  const avvio = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  const esito = await avvio.done;
  togliEsecutoreFinto();
  assert.deepEqual(tentativiBloccati, [], "il giro ha provato a uscire sulla rete");
  return { status: esito.status, logs: avvio.progress.logs ?? [] };
}

const DIECI_ONLINE = da(1, 10).map((i) => ({ ip: i, status: "online" as const }));

test("applica: 0 vivi su 10 online, nessun host cambia stato e il giro lo dice", async () => {
  const reteId = withTenant(T, () => preparaRete(DIECI_ONLINE));
  withTenant(T, () => impostazione("offline_guard_mode", "applica"));

  const { status, logs } = await giro(reteId, []);

  assert.equal(status, "completed");
  assert.deepEqual(offline(reteId), [], "un giro che non vede nessuno ha spento la rete");
  assert.ok(
    logs.some((l) => /soglia superata/i.test(l) && /10 non marcati/.test(l)),
    `manca la riga della soglia nel log del giro: ${logs.join(" | ")}`,
  );
  assert.match(ultimaStoria(reteId), /soglia offline: 10 non marcati/);
});

test("applica: calo del 60% bloccato, il giro dopo (anche dopo un riavvio) applica l'intersezione", async () => {
  const reteId = withTenant(T, () => preparaRete(DIECI_ONLINE));
  withTenant(T, () => impostazione("offline_guard_mode", "applica"));

  // Giro 1: rispondono 1-4, candidati 5-10 (6 su 10): bloccato.
  await giro(reteId, da(1, 4));
  assert.deepEqual(offline(reteId), []);

  // Passa il tempo (i giri sono a un'ora l'uno dall'altro: senza questo il
  // `last_seen` scritto dal giro 1 cadrebbe nello stesso secondo dell'inizio del
  // giro 2) e il servizio si riavvia: la connessione al DB del tenant si chiude.
  withTenant(T, () => db().prepare("UPDATE hosts SET last_seen = ? WHERE network_id = ?").run(VECCHIO, reteId));
  closeTenantDb(T);

  // Giro 2: rispondono 1-3 e 10, candidati 4-9 (6 su 10): ancora sopra soglia.
  // Confermati in due giri: 5-9. Il 4 è nuovo: resta in sospeso.
  const { logs } = await giro(reteId, [...da(1, 3), ip(10)]);
  assert.deepEqual(offline(reteId), da(5, 9).sort());
  assert.equal(statoHost(reteId).get(ip(4)), "online");
  assert.ok(logs.some((l) => /5 confermati/.test(l)), `manca la riga dei confermati: ${logs.join(" | ")}`);
});

test("registra (predefinito): si applica come prima e si scrive «qui avrei bloccato»", async () => {
  const reteId = withTenant(T, () => preparaRete(DIECI_ONLINE));

  const { logs } = await giro(reteId, []);

  assert.deepEqual(offline(reteId), da(1, 10).sort());
  assert.ok(
    logs.some((l) => /avrei bloccato 10/.test(l)),
    `manca la riga «avrei bloccato» nel log del giro: ${logs.join(" | ")}`,
  );
  assert.match(ultimaStoria(reteId), /soglia offline \(registra\): avrei bloccato 10/);
});

// ─── Decisione pura ──────────────────────────────────────────────────────────

const APPLICA: ImpostazioniSogliaOffline = { modo: "applica", pct: 50, min: 5 };
const REGISTRA: ImpostazioniSogliaOffline = { modo: "registra", pct: 50, min: 5 };
const ids = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("decisione: sotto soglia si applica subito e non resta niente in sospeso", () => {
  const d = decidiPassaggioOffline({ candidati: ids(1, 5), attivi: 10, inSospeso: [], impostazioni: APPLICA });
  assert.deepEqual(d.daApplicare, ids(1, 5)); // 5 su 10 è la metà, non più della metà
  assert.equal(d.sogliaSuperata, false);
  assert.deepEqual(d.nuovoInSospeso, []);
});

test("decisione: sotto il minimo non scatta anche se è tutta la rete", () => {
  const d = decidiPassaggioOffline({ candidati: ids(1, 4), attivi: 4, inSospeso: [], impostazioni: APPLICA });
  assert.equal(d.sogliaSuperata, false);
  assert.deepEqual(d.daApplicare, ids(1, 4));
});

test("decisione: sopra soglia senza sospesi non applica niente e trattiene tutto", () => {
  const d = decidiPassaggioOffline({ candidati: ids(1, 6), attivi: 10, inSospeso: [], impostazioni: APPLICA });
  assert.equal(d.sogliaSuperata, true);
  assert.deepEqual(d.daApplicare, []);
  assert.equal(d.bloccati, 6);
  assert.deepEqual(d.nuovoInSospeso, ids(1, 6));
});

test("decisione: sopra soglia coi sospesi applica l'intersezione e trattiene il resto", () => {
  const d = decidiPassaggioOffline({ candidati: ids(4, 9), attivi: 10, inSospeso: ids(5, 10), impostazioni: APPLICA });
  assert.deepEqual(d.daApplicare, ids(5, 9));
  assert.equal(d.confermati, 5);
  assert.deepEqual(d.nuovoInSospeso, [4]);
  assert.equal(d.bloccati, 1);
});

test("decisione: in registra si applica tutto e si conta quanto si sarebbe bloccato", () => {
  const sopra = decidiPassaggioOffline({ candidati: ids(1, 6), attivi: 10, inSospeso: [], impostazioni: REGISTRA });
  assert.deepEqual(sopra.daApplicare, ids(1, 6));
  assert.equal(sopra.avreiBloccato, 6);
  assert.deepEqual(sopra.nuovoInSospeso, []);
  const sotto = decidiPassaggioOffline({ candidati: ids(1, 3), attivi: 10, inSospeso: [], impostazioni: REGISTRA });
  assert.equal(sotto.avreiBloccato, 0);
});

test("impostazioni: predefinite registra/50/5; valori fuori forma valgono il predefinito", () => {
  assert.deepEqual(impostazioniDa(() => null), IMPOSTAZIONI_PREDEFINITE);
  assert.deepEqual(IMPOSTAZIONI_PREDEFINITE, { modo: "registra", pct: 50, min: 5 });
  const valori: Record<string, string> = { offline_guard_mode: "APPLICA!", offline_guard_pct: "150", offline_guard_min: "-3" };
  assert.deepEqual(impostazioniDa((k) => valori[k] ?? null), IMPOSTAZIONI_PREDEFINITE);
  const buoni: Record<string, string> = { offline_guard_mode: "applica", offline_guard_pct: "30", offline_guard_min: "8" };
  assert.deepEqual(impostazioniDa((k) => buoni[k] ?? null), { modo: "applica", pct: 30, min: 8 });
});

test("sospesi illeggibili valgono «nessuno in sospeso», segnalati", () => {
  assert.deepEqual(leggiInSospeso(null), { ids: [], illeggibile: false });
  assert.deepEqual(leggiInSospeso(""), { ids: [], illeggibile: false });
  assert.deepEqual(leggiInSospeso("{non json"), { ids: [], illeggibile: true });
  assert.deepEqual(leggiInSospeso('{"ids":["a"]}'), { ids: [], illeggibile: true });
  assert.deepEqual(leggiInSospeso('{"ids":[3,4]}'), { ids: [3, 4], illeggibile: false });
});

// ─── Sul DB del tenant ───────────────────────────────────────────────────────

const INIZIO = "2026-10-13 10:00:00";

/** Un passaggio a offline: rispondono gli IP in `vivi`, scansionati tutti quelli della rete. */
function passaggio(reteId: number, scansionati: string[], vivi: string[]) {
  return withTenant(T, () => passaggioOfflineConSoglia(reteId, vivi, scansionati, INIZIO));
}

test("tre giri con insiemi sovrapposti: offline solo gli host candidati in due giri di fila", () => {
  const tutti = da(1, 12);
  const reteId = withTenant(T, () => preparaRete(tutti.map((i) => ({ ip: i, status: "online" as const }))));
  withTenant(T, () => impostazione("offline_guard_mode", "applica"));
  const tranne = (giu: string[]) => tutti.filter((i) => !giu.includes(i));

  // Giro 1: giù 1-8 (8 su 12): bloccato.
  const g1 = passaggio(reteId, tutti, tranne(da(1, 8)));
  assert.equal(g1.passati, 0);
  assert.equal(g1.bloccati, 8);
  // Giro 2: giù 5-12 (8 su 12): confermati 5-8, trattenuti 9-12.
  const g2 = passaggio(reteId, tutti, tranne(da(5, 12)));
  assert.equal(g2.passati, 4);
  assert.deepEqual(offline(reteId), da(5, 8).sort());
  // Giro 3: giù 1-2 e 9-12 (6 su 8 attivi): confermati 9-12, trattenuti 1-2.
  const g3 = passaggio(reteId, tutti, tranne([...da(1, 2), ...da(9, 12)]));
  assert.equal(g3.passati, 4);
  assert.equal(g3.bloccati, 2);
  assert.deepEqual(offline(reteId), da(5, 12).sort());
  assert.equal(statoHost(reteId).get(ip(1)), "online");
});

test("un calo sotto soglia si applica subito e svuota i sospesi", () => {
  const tutti = da(1, 10);
  const reteId = withTenant(T, () => preparaRete(tutti.map((i) => ({ ip: i, status: "online" as const }))));
  withTenant(T, () => impostazione("offline_guard_mode", "applica"));
  passaggio(reteId, tutti, da(1, 3)); // 7 su 10: bloccato, 7 in sospeso
  const g = passaggio(reteId, tutti, tutti.filter((i) => i !== ip(10))); // 1 su 10
  assert.equal(g.passati, 1);
  assert.deepEqual(offline(reteId), [ip(10)]);
  const resta = withTenant(T, () =>
    db().prepare("SELECT value FROM tenant_settings WHERE key = ?").get(chiaveInSospeso(reteId)),
  ) as { value: string } | undefined;
  assert.equal(resta?.value ?? "", "", "i sospesi del giro prima sono rimasti");
});

test("gli host già offline non entrano nel conto della soglia", () => {
  // 6 online e 14 già offline; non rispondono 4 online: 4 su 6 attivi supera la
  // soglia (con minimo 3). Contando anche gli offline sarebbe 4 su 20, sotto.
  const online = da(1, 6);
  const giaOffline = Array.from({ length: 14 }, (_, i) => `10.252.0.${i + 1}`);
  const reteId = withTenant(T, () =>
    preparaRete([
      ...online.map((i) => ({ ip: i, status: "online" as const })),
      ...giaOffline.map((i) => ({ ip: i, status: "offline" as const })),
    ]),
  );
  withTenant(T, () => {
    impostazione("offline_guard_mode", "applica");
    impostazione("offline_guard_min", "3");
  });
  const g = passaggio(reteId, [...online, ...giaOffline], da(1, 2));
  assert.equal(g.attivi, 6);
  assert.equal(g.bloccati, 4);
  assert.equal(g.passati, 0);
});

test("sospesi illeggibili nel DB: il giro trattiene di nuovo invece di applicare", () => {
  const tutti = da(1, 10);
  const reteId = withTenant(T, () => preparaRete(tutti.map((i) => ({ ip: i, status: "online" as const }))));
  withTenant(T, () => {
    impostazione("offline_guard_mode", "applica");
    impostazione(chiaveInSospeso(reteId), "{rotto");
  });
  const g = passaggio(reteId, tutti, []);
  assert.equal(g.passati, 0);
  assert.equal(g.bloccati, 10);
});

// Revisione 3b: i sospesi sono una chiave per rete, ma un giro mirato (host
// selezionati dalla pagina rete, oppure IP esclusi perché il ping non ha potuto
// girare, T3-19) vede solo una parte della rete. Prima riscriveva la chiave
// guardando solo i suoi IP e cancellava la conferma degli host fuori dal suo
// perimetro: con un giro mirato fra due giri completi la guardia non
// confermava mai niente e gli host spenti davvero restavano online.
test("un giro mirato fra due giri completi non cancella la conferma degli host fuori dal suo perimetro", () => {
  const tutti = da(1, 12);
  const reteId = withTenant(T, () => preparaRete(tutti.map((i) => ({ ip: i, status: "online" as const }))));
  withTenant(T, () => impostazione("offline_guard_mode", "applica"));
  const tranne = (giu: string[]) => tutti.filter((i) => !giu.includes(i));

  // Giro completo 1: giù 1-8 (8 su 12): bloccato, 8 in sospeso.
  const g1 = passaggio(reteId, tutti, tranne(da(1, 8)));
  assert.equal(g1.bloccati, 8);

  // Giro mirato su 10, 11 e 1: giù il 10 e l'1 (2 su 3, sotto il minimo di 5):
  // si applica subito. L'1 era in sospeso: confermato e marcato.
  const mirati = [ip(1), ip(10), ip(11)];
  const m = passaggio(reteId, mirati, [ip(11)]);
  assert.equal(m.passati, 2);
  assert.deepEqual(offline(reteId), [ip(1), ip(10)].sort());

  // Giro completo 2: giù ancora 2-8 (e 1, 10 già offline): sopra soglia (7 su 10).
  // Gli host 2-8 erano in sospeso dal giro 1: confermati e marcati.
  const g2 = passaggio(reteId, tutti, tranne([...da(1, 8), ip(10)]));
  assert.equal(g2.confermati, 7, "il giro mirato ha cancellato la conferma degli host fuori dal suo perimetro");
  assert.equal(g2.passati, 7);
  assert.deepEqual(offline(reteId), [...da(1, 8), ip(10)].sort());
});

test("un giro mirato sopra soglia tiene i sospesi fuori dal suo perimetro e aggiunge i suoi", () => {
  const tutti = da(1, 12);
  const reteId = withTenant(T, () => preparaRete(tutti.map((i) => ({ ip: i, status: "online" as const }))));
  withTenant(T, () => {
    impostazione("offline_guard_mode", "applica");
    impostazione("offline_guard_min", "2");
  });
  const tranne = (giu: string[]) => tutti.filter((i) => !giu.includes(i));

  // Giro completo: giù 1-8: tutti in sospeso.
  passaggio(reteId, tutti, tranne(da(1, 8)));
  // Giro mirato su 9-11, giù 9 e 10 (2 su 3, sopra soglia col minimo a 2): trattenuti.
  const m = passaggio(reteId, da(9, 11), [ip(11)]);
  assert.equal(m.bloccati, 2);
  assert.equal(m.passati, 0);
  // Giro completo: giù 1-10. Confermati 1-8 (giro 1) e 9-10 (giro mirato).
  const g = passaggio(reteId, tutti, tranne(da(1, 10)));
  assert.equal(g.confermati, 10);
  assert.deepEqual(offline(reteId), da(1, 10).sort());
});

test("decisione: i sospesi fuori dal perimetro del giro restano in sospeso e non contano", () => {
  const d = decidiPassaggioOffline({
    candidati: [10],
    attivi: 3,
    inSospeso: ids(1, 8),
    perimetro: [1, 10, 11],
    impostazioni: APPLICA,
  });
  assert.deepEqual(d.daApplicare, [10]);
  assert.equal(d.confermati, 0);
  assert.deepEqual(d.nuovoInSospeso, ids(2, 8), "fuori perimetro: 2-8 restano; l'1 è stato visto vivo");
});
