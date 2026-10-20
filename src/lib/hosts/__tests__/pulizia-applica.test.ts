/**
 * «Applica» della pulizia degli host (piano 2026-10-20, Task 4; casi 3 e 5). Zona rossa: è il pulsante che
 * toglie host del cliente. Si archivia solo l'intersezione fra gli id mandati e i candidati di ADESSO: fra
 * anteprima e «Applica» un host può tornare online, e una richiesta scritta a mano può mandare l'id di un host
 * escluso (apparato, credenziali…). Il numero confermato dall'utente deve essere quello degli id mandati, se no
 * non si tocca niente. Ogni «Applica» cancella anche l'archivio scaduto (90 giorni), che a job spento non
 * ripulirebbe nessuno (caso 5).
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia-applica.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { applicaPulizia, archiviaHost, ErroreApplica, ErroreConferma } from "@/lib/hosts/pulizia-archivio";
import { candidatiPulizia } from "@/lib/hosts/pulizia-candidati";
import { rispostaApplica, rispostaRecupera } from "@/lib/hosts/pulizia-server";

const T = "PULIZIAAPPL2010";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

let reti = 0;
function nuovaRete(d: Database.Database): { id: number; prefisso: string } {
  reti += 1;
  const prefisso = `10.${100 + reti}.0`;
  const id = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`${prefisso}.0/24`, `r${reti}`).lastInsertRowid);
  return { id, prefisso };
}

/** Un host come lo scrive la scansione: hostname, note automatiche, date di SQLite. */
function host(d: Database.Database, rete: number, ip: string, o: { status?: string; giorni?: number } = {}): number {
  return Number(d.prepare(`INSERT INTO hosts (network_id, ip, mac, hostname, notes, status, first_seen, last_seen)
      VALUES (?, ?, NULL, ?, '[DHCP: mikrotik] lease 2026-07-12', ?, datetime('now', '-200 days'), datetime('now', ?))`)
    .run(rete, ip, `pc-${ip.split(".").at(-1)}`, o.status ?? "offline", `-${o.giorni ?? 100} days`).lastInsertRowid);
}

const inHosts = (d: Database.Database, id: number) => d.prepare("SELECT 1 FROM hosts WHERE id = ?").get(id) !== undefined;
const conta = (d: Database.Database, tabella: "hosts" | "hosts_archivio") =>
  (d.prepare(`SELECT COUNT(*) AS n FROM ${tabella}`).get() as { n: number }).n;

/** Una riga d'archivio vera (archiviaHost), riportata indietro di `giorni`. */
function archivioVecchio(d: Database.Database, rete: { id: number; prefisso: string }, ultimo: number, giorni: number): number {
  const a = archiviaHost(host(d, rete.id, `${rete.prefisso}.${ultimo}`), "assente", "assente da 100 giorni", "anna");
  d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', ?) WHERE id = ?").run(`-${giorni} days`, a.id);
  return a.id;
}

test("conferma diversa dal numero di id: ErroreConferma, niente archiviato e niente cancellato dall'archivio", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const scaduta = archivioVecchio(d, rete, 9, 91);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const b = host(d, rete.id, `${rete.prefisso}.11`);
    const prima = { hosts: conta(d, "hosts"), archivio: conta(d, "hosts_archivio") };
    for (const conferma of [1, 3, 0]) {
      assert.throws(() => applicaPulizia([a, b], conferma, "anna"), ErroreConferma);
    }
    assert.deepEqual({ hosts: conta(d, "hosts"), archivio: conta(d, "hosts_archivio") }, prima);
    assert.ok(inHosts(d, a) && inHosts(d, b));
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(scaduta), "la riga scaduta resta: con la conferma sbagliata non gira niente");
  });
});

test("elenco vuoto, id ripetuti o non interi: ErroreConferma, niente scritto", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const prima = conta(d, "hosts");
    assert.throws(() => applicaPulizia([], 0, "anna"), ErroreConferma);
    assert.throws(() => applicaPulizia([a, a], 2, "anna"), ErroreConferma);
    assert.throws(() => applicaPulizia([a, 1.5], 2, "anna"), ErroreConferma);
    assert.throws(() => applicaPulizia([a, -3], 2, "anna"), ErroreConferma);
    assert.equal(conta(d, "hosts"), prima);
    assert.ok(inHosts(d, a));
  });
});

test("archivia i candidati dell'anteprima, col motivo e il dettaglio di adesso, e li dice per nome", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`, { giorni: 74 });
    const b = host(d, rete.id, `${rete.prefisso}.11`, { giorni: 120 });
    const anteprima = candidatiPulizia().candidati.filter((c) => c.id === a || c.id === b);
    assert.equal(anteprima.length, 2, "tutti e due in anteprima");

    const esito = applicaPulizia([a, b], 2, "anna");
    assert.deepEqual(esito.archiviati.map((x) => [x.id, x.ip, x.nome]), [
      [a, `${rete.prefisso}.10`, "pc-10"],
      [b, `${rete.prefisso}.11`, "pc-11"],
    ]);
    assert.deepEqual(esito.nonPiuCandidati, []);
    assert.ok(!inHosts(d, a) && !inHosts(d, b), "tolti da hosts");
    const righe = d.prepare("SELECT host_id_originale, motivo, dettaglio, archiviato_da FROM hosts_archivio WHERE host_id_originale IN (?, ?) ORDER BY host_id_originale")
      .all(a, b) as Array<{ host_id_originale: number; motivo: string; dettaglio: string; archiviato_da: string }>;
    assert.deepEqual(righe.map((r) => [r.host_id_originale, r.motivo, r.dettaglio, r.archiviato_da]),
      anteprima.sort((x, y) => x.id - y.id).map((c) => [c.id, c.motivo, c.dettaglio, "anna"]));
  });
});

test("tornato online fra anteprima e «Applica»: fra i non più candidati, per nome, e ancora in hosts", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const resta = host(d, rete.id, `${rete.prefisso}.10`);
    const torna = host(d, rete.id, `${rete.prefisso}.11`);
    const ids = candidatiPulizia().candidati.map((c) => c.id).filter((id) => id === resta || id === torna);
    assert.equal(ids.length, 2);
    // La scansione lo ritrova in mezzo: come lo scrive lei.
    d.prepare("UPDATE hosts SET status = 'online', last_seen = datetime('now') WHERE id = ?").run(torna);

    const esito = applicaPulizia(ids, 2, "anna");
    assert.deepEqual(esito.archiviati.map((x) => x.id), [resta]);
    assert.deepEqual(esito.nonPiuCandidati, [{ id: torna, ip: `${rete.prefisso}.11`, nome: "pc-11" }]);
    assert.ok(inHosts(d, torna), "l'host tornato online è ancora in hosts");
    assert.equal(d.prepare("SELECT 1 FROM hosts_archivio WHERE host_id_originale = ?").get(torna), undefined);
  });
});

test("richiesta scritta a mano con l'id di un host escluso o di uno online: non si archiviano, si elencano", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const conCredenziali = host(d, rete.id, `${rete.prefisso}.10`);
    const cred = Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES ('ssh-admin', 'ssh')").run().lastInsertRowid);
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (?, ?, 'ssh', 22)").run(conCredenziali, cred);
    const online = host(d, rete.id, `${rete.prefisso}.11`, { status: "online", giorni: 0 });
    const recente = host(d, rete.id, `${rete.prefisso}.12`, { giorni: 10 });
    const nonEsiste = 987654;

    const esito = applicaPulizia([conCredenziali, online, recente, nonEsiste], 4, "anna");
    assert.deepEqual(esito.archiviati, []);
    assert.deepEqual(esito.nonPiuCandidati.map((x) => [x.id, x.nome]), [
      [conCredenziali, "pc-10"],
      [online, "pc-11"],
      [recente, "pc-12"],
      [nonEsiste, `host #${nonEsiste} (non c'è più)`],
    ]);
    for (const id of [conCredenziali, online, recente]) assert.ok(inHosts(d, id), `host #${id} ancora in hosts`);
  });
});

test("un id già archiviato da un altro «Applica»: fra i non più candidati, col nome dell'archivio", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    applicaPulizia([a], 1, "marco");
    const esito = applicaPulizia([a], 1, "anna");
    assert.deepEqual(esito.archiviati, []);
    assert.deepEqual(esito.nonPiuCandidati, [{ id: a, ip: `${rete.prefisso}.10`, nome: "pc-10 (già in archivio)" }]);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio WHERE host_id_originale = ?").get(a) as { n: number }).n, 1);
  });
});

test("ogni «Applica» cancella l'archivio scaduto: la riga a 91 giorni va, quella a 89 resta", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const v91 = archivioVecchio(d, rete, 20, 91);
    const v89 = archivioVecchio(d, rete, 21, 89);
    const a = host(d, rete.id, `${rete.prefisso}.10`);

    const esito = applicaPulizia([a], 1, "anna");
    assert.ok(esito.cancellatiDallArchivio.some((x) => x.id === v91 && x.ip === `${rete.prefisso}.20` && x.nome === "pc-20"));
    assert.ok(!esito.cancellatiDallArchivio.some((x) => x.id === v89));
    assert.equal(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(v91), undefined, "a 91 giorni cancellata");
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(v89), "a 89 giorni resta");
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE host_id_originale = ?").get(a), "quella appena scritta resta");
  });
});

test("anche senza nessun candidato rimasto l'archivio scaduto si cancella", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const v91 = archivioVecchio(d, rete, 30, 91);
    const online = host(d, rete.id, `${rete.prefisso}.31`, { status: "online", giorni: 0 });
    const esito = applicaPulizia([online], 1, "anna");
    assert.deepEqual(esito.archiviati, []);
    assert.ok(esito.cancellatiDallArchivio.some((x) => x.id === v91));
  });
});

test("guasto a metà: i già archiviati restano archiviati, l'errore li nomina con quelli rimasti, niente archivio cancellato", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const v91 = archivioVecchio(d, rete, 40, 91);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const b = host(d, rete.id, `${rete.prefisso}.11`);
    const c = host(d, rete.id, `${rete.prefisso}.12`);
    // Il DELETE di b fallisce come fallirebbe un vincolo vero: archiviaHost di b si annulla tutta.
    d.exec(`CREATE TEMP TRIGGER prova_guasto BEFORE DELETE ON hosts WHEN OLD.id = ${b} BEGIN SELECT RAISE(ABORT, 'guasto di prova'); END`);
    try {
      let preso: unknown;
      try { applicaPulizia([a, b, c], 3, "anna"); } catch (e) { preso = e; }
      assert.ok(preso instanceof ErroreApplica, "errore che dice cosa è successo");
      assert.deepEqual(preso.archiviati.map((x) => x.id), [a]);
      assert.deepEqual(preso.nonArchiviati.map((x) => x.id), [b, c]);
      assert.match(preso.message, /pc-10/);
      assert.match(preso.message, /pc-11/);
      assert.match(preso.message, /guasto di prova/);
    } finally {
      d.exec("DROP TRIGGER IF EXISTS prova_guasto");
    }
    assert.ok(!inHosts(d, a), "a archiviato davvero");
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE host_id_originale = ?").get(a));
    assert.ok(inHosts(d, b) && inHosts(d, c), "b e c ancora in hosts");
    assert.equal(d.prepare("SELECT 1 FROM hosts_archivio WHERE host_id_originale IN (?, ?)").get(b, c), undefined);
    assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(v91), "dopo un guasto non si cancella l'archivio");
  });
});

// La rotta (POST /api/hosts/pulizia) è l'involucro di rispostaApplica: guardia e sessione non si provano qui
// (`mock.module` non gira sotto Node 22 con tsx; la guardia admin la prova il censimento rotte-censite).
test("rotta: conferma sbagliata → 400 col messaggio, niente archiviato; corpo con campi in più → 400", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const prima = conta(d, "hosts");

    const sbagliata = rispostaApplica({ ids: [a], conferma: 2 }, "anna");
    assert.equal(sbagliata.status, 400);
    assert.match((sbagliata.body as { error: string }).error, /1/);
    assert.equal(conta(d, "hosts"), prima);

    const casi: Array<[unknown, string]> = [
      [null, "Corpo della richiesta non valido: servono ids e conferma"],
      [{ ids: [a] }, "Manca il numero di host confermato"],
      [{ ids: [], conferma: 0 }, "Nessun host da archiviare nell'elenco"],
      [{ ids: [a], conferma: 1, tutti: true }, "La richiesta contiene campi non previsti"],
      [{ ids: ["1"], conferma: 1 }, "Gli host si indicano con il loro id numerico"],
      [{ ids: [a, a], conferma: 2 }, "L'elenco contiene lo stesso host più di una volta"],
    ];
    for (const [corpo, messaggio] of casi) {
      const r = rispostaApplica(corpo, "anna");
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.equal((r.body as { error: string }).error, messaggio);
    }
    assert.ok(inHosts(d, a));

    const giusta = rispostaApplica({ ids: [a], conferma: 1 }, "anna");
    assert.equal(giusta.status, 200);
    assert.deepEqual((giusta.body as { archiviati: Array<{ id: number }> }).archiviati.map((x) => x.id), [a]);
  });
});

test("rotta recupera: id non valido → 400, rifiuto → 409 col motivo, riuscito → 200", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = host(d, rete.id, `${rete.prefisso}.10`);
    const riga = archiviaHost(a, "assente", "assente da 100 giorni", "anna");
    assert.equal(rispostaRecupera("abc", "anna").status, 400);
    assert.equal(rispostaRecupera("0", "anna").status, 400);
    // IP di nuovo occupato: rifiuto col motivo.
    const occupante = host(d, rete.id, `${rete.prefisso}.10`, { status: "online", giorni: 0 });
    const rifiuto = rispostaRecupera(String(riga.id), "anna");
    assert.equal(rifiuto.status, 409);
    assert.match((rifiuto.body as { motivo: string }).motivo, /di nuovo in uso/);
    d.prepare("DELETE FROM hosts WHERE id = ?").run(occupante);
    const ok = rispostaRecupera(String(riga.id), "anna");
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { ok: boolean }).ok, true);
  });
});
