/**
 * Chi scrive le credenziali degli apparati scrive solo binding d'archivio
 * (tappa 2e credenziali, T20 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: dopo la conversione della 2e (T19) le colonne di `network_devices`
 * e i binding inline sono vuoti, ma chi scrive scriveva ancora lì:
 * - il PATCH in blocco scriveva solo colonne, che il motore legge dopo i
 *   binding: una scelta in blocco non cambiava niente, e dopo la 2g non
 *   avrebbe più nessun effetto. Ora una voce scelta va in testa ai binding del
 *   suo protocollo (non provata), e i binding che ci sono restano con la loro
 *   storia di prova (18 riusciti in H1);
 * - «Nessuna» azzerava una colonna invisibile: ora toglie i binding di quel
 *   protocollo, e solo dopo una conferma che ne dice il numero;
 * - l'assegnazione in blocco ai router delle reti scriveva le colonne del
 *   router (e la community cifrata): dopo la 2g «Credenziali assegnate a N
 *   router» senza effetto;
 * - la modifica di un binding scriveva utente e password dentro il binding
 *   (inline), e una voce condivisa con altri apparati si cambiava per tutti;
 * - `delete` cancellava un binding di un altro apparato (l'id non si
 *   confrontava con l'apparato dell'URL).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/apparato-archivio.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "@/lib/db-tenant-schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";
import {
  aggiornaSegretoBindingDb,
  applicaCorpoApparatoDb,
  applicaVociApparatiDb,
  assegnaVociAiRouterDb,
  eliminaBindingApparatoDb,
  nuovaVoceEBindingDb,
  RifiutoCredenziali,
  segretiInVociApparatoDb,
  usataAdessoDb,
} from "@/lib/credentials/apparato-archivio";

void TEST_DATA_DIR;

// ── Appoggio ────────────────────────────────────────────────────────────────

function nuovoDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(TENANT_SCHEMA_SQL);
  d.exec(TENANT_INDEXES_SQL);
  return d;
}

function voce(d: Database.Database, nome: string, tipo: string, o: { utente?: string; segreto?: string; port?: number | null; metodo?: string } = {}): number {
  return Number(
    d
      .prepare("INSERT INTO credentials (name, credential_type, auth_method, encrypted_username, encrypted_password, port) VALUES (?, ?, ?, ?, ?, ?)")
      .run(nome, tipo, o.metodo ?? null, o.utente != null ? encrypt(o.utente) : null, o.segreto != null ? encrypt(o.segreto) : null, o.port ?? null)
      .lastInsertRowid,
  );
}

let indirizzo = 0;
function apparato(d: Database.Database, nome: string, protocol: string, port: number, colonne: Record<string, unknown> = {}): number {
  indirizzo++;
  const campi = ["name", "host", "device_type", "vendor", "protocol", "port", ...Object.keys(colonne)];
  const valori = [nome, `10.60.0.${indirizzo}`, "switch", "hp", protocol, port, ...Object.values(colonne)];
  return Number(d.prepare(`INSERT INTO network_devices (${campi.join(", ")}) VALUES (${campi.map(() => "?").join(", ")})`).run(...valori).lastInsertRowid);
}

function binding(
  d: Database.Database,
  deviceId: number,
  credentialId: number | null,
  protocollo: string,
  port: number,
  o: { ordine?: number; stato?: "success" | "failed" | "untested"; provato?: string | null; utenteInline?: string; segretoInline?: string } = {},
): number {
  return Number(
    d
      .prepare(
        `INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status, tested_at, inline_username, inline_encrypted_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(deviceId, credentialId, protocollo, port, o.ordine ?? 0, o.stato ?? "untested", o.provato ?? null, o.utenteInline ?? null, o.segretoInline ?? null).lastInsertRowid,
  );
}

interface RigaBinding {
  id: number;
  credential_id: number | null;
  protocol_type: string;
  port: number;
  sort_order: number;
  test_status: string;
  tested_at: string | null;
  inline_username: string | null;
  inline_encrypted_password: string | null;
}

/** I binding di un apparato nell'ordine del motore a parità di stato (sort_order, id). */
function bindingDi(d: Database.Database, deviceId: number, protocollo?: string): RigaBinding[] {
  const filtro = protocollo ? "AND protocol_type = ?" : "";
  const arg = protocollo ? [deviceId, protocollo] : [deviceId];
  return d.prepare(`SELECT * FROM device_credential_bindings WHERE device_id = ? ${filtro} ORDER BY sort_order, id`).all(...arg) as RigaBinding[];
}

const COLONNE = ["credential_id", "snmp_credential_id", "username", "encrypted_password", "community_string", "api_token"] as const;

function colonneDi(d: Database.Database, deviceId: number): Record<string, unknown> {
  return d.prepare(`SELECT ${COLONNE.join(", ")} FROM network_devices WHERE id = ?`).get(deviceId) as Record<string, unknown>;
}

const VUOTE = Object.fromEntries(COLONNE.map((c) => [c, null]));

function voceDb(d: Database.Database, id: number): Record<string, unknown> {
  return d.prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Record<string, unknown>;
}

function contaVoci(d: Database.Database): number {
  return (d.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
}

function rifiuto(f: () => unknown): RifiutoCredenziali {
  try {
    f();
  } catch (e) {
    if (e instanceof RifiutoCredenziali) return e;
    throw e;
  }
  assert.fail("doveva rifiutare");
}

// ── PATCH in blocco ─────────────────────────────────────────────────────────

describe("modifica in blocco: una voce scelta va in testa, i binding che ci sono restano", () => {
  it("binding riuscito: il nuovo va in testa, non provato; il riuscito resta con stato e data di prova", () => {
    const d = nuovoDb();
    const vecchia = voce(d, "admin vecchio", "windows", { utente: "a", segreto: "b" });
    const nuova = voce(d, "admin nuovo", "windows", { utente: "c", segreto: "d" });
    const S = apparato(d, "srv", "winrm", 5985);
    const riuscito = binding(d, S, vecchia, "winrm", 5985, { ordine: 0, stato: "success", provato: "2026-10-10 08:00:00" });

    const esito = applicaVociApparatiDb(d, [S], { credential_id: nuova }, { conferma: false });

    assert.equal(esito.aggiunti, 1);
    const righe = bindingDi(d, S, "winrm");
    assert.equal(righe.length, 2);
    assert.equal(righe[0].credential_id, nuova, "la voce scelta è in testa");
    assert.equal(righe[0].test_status, "untested");
    assert.equal(righe[0].port, 5985);
    const r = righe.find((b) => b.id === riuscito);
    assert.ok(r, "il binding riuscito c'è ancora");
    assert.equal(r.test_status, "success");
    assert.equal(r.tested_at, "2026-10-10 08:00:00");
    assert.deepEqual(colonneDi(d, S), VUOTE, "nessuna colonna scritta");
  });

  it("la voce c'è già fra i binding del protocollo: non si duplica, va in testa con la sua storia", () => {
    const d = nuovoDb();
    const a = voce(d, "a", "ssh", { utente: "u", segreto: "p" });
    const b = voce(d, "b", "ssh", { utente: "u", segreto: "q" });
    const S = apparato(d, "sw", "ssh", 22);
    binding(d, S, a, "ssh", 22, { ordine: 0 });
    const giaLegata = binding(d, S, b, "ssh", 22, { ordine: 1, stato: "success", provato: "2026-10-11 09:00:00" });

    const esito = applicaVociApparatiDb(d, [S], { credential_id: b }, { conferma: false });

    assert.deepEqual([esito.aggiunti, esito.spostati], [0, 1]);
    const righe = bindingDi(d, S, "ssh");
    assert.equal(righe.length, 2);
    assert.equal(righe[0].id, giaLegata);
    assert.equal(righe[0].test_status, "success");
  });

  it("SNMP: binding sulla porta della voce o 161, mai sulla porta dell'apparato (F3)", () => {
    const d = nuovoDb();
    const comm = voce(d, "community", "snmp", { segreto: "c0mm" });
    const S = apparato(d, "sw snmp", "snmp_v2", 22);
    applicaVociApparatiDb(d, [S], { snmp_credential_id: comm }, { conferma: false });
    assert.deepEqual(bindingDi(d, S, "snmp").map((b) => [b.credential_id, b.port]), [[comm, 161]]);
  });

  it("una voce che non vale per il protocollo dell'apparato: l'apparato si salta, col motivo; gli altri ricevono la voce", () => {
    const d = nuovoDb();
    const win = voce(d, "win", "windows", { utente: "a", segreto: "b" });
    const W = apparato(d, "srv", "winrm", 5985);
    const S = apparato(d, "sw", "ssh", 22);
    const esito = applicaVociApparatiDb(d, [W, S], { credential_id: win }, { conferma: false });
    assert.equal(esito.aggiunti, 1);
    assert.equal(esito.saltati.length, 1);
    assert.equal(esito.saltati[0].device_id, S);
    assert.match(esito.saltati[0].motivo, /non vale per SSH/);
    assert.equal(bindingDi(d, S).length, 0);
  });
});

describe("modifica in blocco: «Nessuna» toglie i binding di quel protocollo, dopo la conferma", () => {
  function scena() {
    const d = nuovoDb();
    const win = voce(d, "win", "windows", { utente: "a", segreto: "b" });
    const win2 = voce(d, "win2", "windows", { utente: "c", segreto: "d" });
    const comm = voce(d, "comm", "snmp", { segreto: "c0mm" });
    const S = apparato(d, "srv", "winrm", 5985, { credential_id: win, username: "vecchio", encrypted_password: encrypt("x") });
    binding(d, S, win, "winrm", 5985, { ordine: 0, stato: "success", provato: "2026-10-10 08:00:00" });
    binding(d, S, win2, "winrm", 5985, { ordine: 1 });
    const snmp = binding(d, S, comm, "snmp", 161, { ordine: 2 });
    return { d, S, snmp, comm };
  }

  it("senza conferma: 409 con la domanda e i numeri, e niente scritto", () => {
    const { d, S } = scena();
    const r = rifiuto(() => applicaVociApparatiDb(d, [S], { credential_id: null }, { conferma: false }));
    assert.equal(r.stato, 409);
    assert.ok(r.conferma);
    assert.equal(r.conferma.binding, 2);
    assert.equal(r.conferma.riusciti, 1);
    assert.equal(r.conferma.apparati, 1);
    assert.equal(r.conferma.domanda, "Togli 2 binding WinRM da 1 apparato, di cui 1 riuscito?");
    assert.equal(bindingDi(d, S).length, 3, "niente tolto");
    assert.notEqual(colonneDi(d, S).credential_id, null, "colonna intatta");
  });

  it("con la conferma: tolti i binding WinRM e svuotata la colonna; SNMP intatto", () => {
    const { d, S, snmp, comm } = scena();
    const esito = applicaVociApparatiDb(d, [S], { credential_id: null }, { conferma: true });
    assert.equal(esito.tolti, 2);
    assert.deepEqual(bindingDi(d, S).map((b) => b.id), [snmp]);
    assert.deepEqual(colonneDi(d, S), VUOTE);
    assert.equal(voceDb(d, comm).name, "comm");
  });

  it("niente da togliere: nessuna domanda, la colonna si svuota lo stesso", () => {
    const d = nuovoDb();
    const comm = voce(d, "comm", "snmp", { segreto: "c0mm" });
    const S = apparato(d, "sw", "ssh", 22, { snmp_credential_id: comm, community_string: encrypt("vecchia") });
    const esito = applicaVociApparatiDb(d, [S], { snmp_credential_id: null }, { conferma: false });
    assert.equal(esito.tolti, 0);
    assert.deepEqual(colonneDi(d, S), VUOTE);
  });

  it("più protocolli e più apparati: la domanda li conta tutti", () => {
    const d = nuovoDb();
    const ssh = voce(d, "ssh", "ssh", { utente: "u", segreto: "p" });
    const win = voce(d, "win", "windows", { utente: "a", segreto: "b" });
    const A = apparato(d, "a", "ssh", 22);
    const B = apparato(d, "b", "winrm", 5985);
    const C = apparato(d, "c", "ssh", 22);
    binding(d, A, ssh, "ssh", 22, { stato: "success" });
    binding(d, B, win, "winrm", 5985);
    const r = rifiuto(() => applicaVociApparatiDb(d, [A, B, C], { credential_id: null }, { conferma: false }));
    assert.equal(r.conferma?.domanda, "Togli 2 binding (SSH 1, WinRM 1) da 2 apparati, di cui 1 riuscito?");
  });
});

// ── PUT del singolo apparato ────────────────────────────────────────────────

describe("modifica del singolo apparato", () => {
  it("solo il nome cambiato: nessun binding toccato, nessuna colonna scritta", () => {
    const d = nuovoDb();
    const ssh = voce(d, "ssh", "ssh", { utente: "u", segreto: "p" });
    const S = apparato(d, "sw", "ssh", 22);
    binding(d, S, ssh, "ssh", 22, { stato: "success", provato: "2026-10-10 08:00:00" });
    const prima = bindingDi(d, S);
    const esito = applicaCorpoApparatoDb(d, S, { name: "sw nuovo" }, { conferma: false });
    assert.deepEqual([esito.aggiunti, esito.spostati, esito.tolti, esito.vociNuove.length], [0, 0, 0, 0]);
    assert.deepEqual(bindingDi(d, S), prima);
    assert.deepEqual(colonneDi(d, S), VUOTE);
  });

  it("utente e password nel corpo: voce «<nome> · SSH» e binding in testa, nessuna colonna", () => {
    const d = nuovoDb();
    const S = apparato(d, "fw", "ssh", 2222);
    const esito = applicaCorpoApparatoDb(d, S, { username: "admin", password: "segreta" }, { conferma: false });
    assert.equal(esito.vociNuove.length, 1);
    const v = voceDb(d, esito.vociNuove[0].id);
    assert.equal(v.name, "fw · SSH");
    assert.equal(v.credential_type, "ssh");
    assert.equal(decrypt(String(v.encrypted_username)), "admin");
    assert.equal(decrypt(String(v.encrypted_password)), "segreta");
    assert.deepEqual(bindingDi(d, S).map((b) => [b.credential_id, b.protocol_type, b.port]), [[esito.vociNuove[0].id, "ssh", 2222]]);
    assert.deepEqual(colonneDi(d, S), VUOTE);
  });

  it("community nel corpo: voce SNMP col testo e binding sulla 161", () => {
    const d = nuovoDb();
    const S = apparato(d, "sw", "snmp_v2", 22);
    const esito = applicaCorpoApparatoDb(d, S, { community_string: "c0mm" }, { conferma: false });
    const v = voceDb(d, esito.vociNuove[0].id);
    assert.deepEqual([v.name, v.credential_type, v.encrypted_username], ["sw · SNMP", "snmp", null]);
    assert.equal(decrypt(String(v.encrypted_password)), "c0mm");
    assert.deepEqual(bindingDi(d, S).map((b) => [b.protocol_type, b.port]), [["snmp", 161]]);
  });

  it("utente senza password: rifiutato, niente scritto", () => {
    const d = nuovoDb();
    const S = apparato(d, "sw", "ssh", 22);
    const r = rifiuto(() => applicaCorpoApparatoDb(d, S, { username: "admin" }, { conferma: false }));
    assert.equal(r.stato, 400);
    assert.equal(contaVoci(d), 0);
  });

  it("una voce che non vale per il protocollo: 400 (nel singolo non si salta in silenzio)", () => {
    const d = nuovoDb();
    const win = voce(d, "win", "windows", { utente: "a", segreto: "b" });
    const S = apparato(d, "sw", "ssh", 22);
    const r = rifiuto(() => applicaCorpoApparatoDb(d, S, { credential_id: win }, { conferma: false }));
    assert.equal(r.stato, 400);
    assert.equal(bindingDi(d, S).length, 0);
  });

  it("nomi già presi: « (apparato #id)»", () => {
    const d = nuovoDb();
    voce(d, "fw · SSH", "ssh", { utente: "x", segreto: "y" });
    const S = apparato(d, "fw", "ssh", 22);
    const voci = segretiInVociApparatoDb(d, S, { username: "admin", password: "p" }, { inTesta: true });
    assert.equal(voci[0].nome, `fw · SSH (apparato #${S})`);
  });
});

// ── Assegnazione ai router delle reti ───────────────────────────────────────

describe("assegnazione in blocco ai router delle reti", () => {
  it("una voce SSH e una SNMP: due binding sul router, nessuna colonna scritta", () => {
    const d = nuovoDb();
    const ssh = voce(d, "ssh", "ssh", { utente: "u", segreto: "p" });
    const comm = voce(d, "comm", "snmp", { segreto: "c0mm", port: 1161 });
    const R = apparato(d, "router", "snmp_v2", 161);
    d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.70.0.0/24', 'rete 1'), (2, '10.71.0.0/24', 'rete 2')").run();
    d.prepare("INSERT INTO network_router (network_id, router_id) VALUES (1, ?), (2, ?)").run(R, R);

    const esito = assegnaVociAiRouterDb(d, [1, 2], { credential_id: ssh, snmp_credential_id: comm }, { conferma: false });

    assert.equal(esito.router, 1, "lo stesso router di due reti conta una volta");
    assert.deepEqual(
      bindingDi(d, R).map((b) => [b.credential_id, b.protocol_type, b.port]).sort(),
      [[comm, "snmp", 1161], [ssh, "ssh", 22]].sort(),
    );
    assert.deepEqual(colonneDi(d, R), VUOTE);
  });
});

// ── Binding della tabella dell'apparato ─────────────────────────────────────

describe("tabella delle credenziali dell'apparato", () => {
  it("«Nuova»: la voce nasce nell'archivio col nome dell'apparato e il binding la punta", () => {
    const d = nuovoDb();
    const S = apparato(d, "nas", "ssh", 22);
    const { binding: b, voce: v } = nuovaVoceEBindingDb(d, S, "ssh", 2022, { username: "root", password: "pw" });
    assert.equal(v.nome, "nas · SSH");
    assert.equal(b.credential_id, v.id);
    assert.equal(b.inline_username, null);
    assert.equal(b.inline_encrypted_password, null);
    assert.equal(voceDb(d, v.id).port, 2022, "porta non standard: sulla voce");
  });

  it("modifica di utente e password su una voce condivisa: voce nuova dell'apparato, la condivisa non cambia, 0 inline", () => {
    const d = nuovoDb();
    const condivisa = voce(d, "admin di tutti", "ssh", { utente: "admin", segreto: "vecchia" });
    const A = apparato(d, "sw-a", "ssh", 22);
    const B = apparato(d, "sw-b", "ssh", 22);
    const bA = binding(d, A, condivisa, "ssh", 22, { stato: "success" });
    binding(d, B, condivisa, "ssh", 22);
    const primaCondivisa = voceDb(d, condivisa);

    const esito = aggiornaSegretoBindingDb(d, A, bA, { username: "admin2", password: "nuova" });

    assert.equal(esito.nuova, true);
    assert.equal(esito.nome, "sw-a · SSH");
    assert.deepEqual(voceDb(d, condivisa), primaCondivisa, "la voce condivisa non cambia");
    const r = bindingDi(d, A)[0];
    assert.equal(r.credential_id, esito.credential_id);
    assert.deepEqual([r.inline_username, r.inline_encrypted_password], [null, null]);
    assert.equal(decrypt(String(voceDb(d, esito.credential_id).encrypted_password)), "nuova");
    const inline = (d.prepare("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE inline_username IS NOT NULL OR inline_encrypted_password IS NOT NULL").get() as { n: number }).n;
    assert.equal(inline, 0);
  });

  it("modifica su una voce usata solo da quel binding: si aggiorna la voce, niente voce nuova", () => {
    const d = nuovoDb();
    const S = apparato(d, "sw", "ssh", 22);
    const propria = voce(d, "sw · SSH", "ssh", { utente: "admin", segreto: "vecchia" });
    const b = binding(d, S, propria, "ssh", 22);
    const voci = contaVoci(d);
    const esito = aggiornaSegretoBindingDb(d, S, b, { username: "admin", password: "nuova" });
    assert.deepEqual([esito.credential_id, esito.nuova], [propria, false]);
    assert.equal(contaVoci(d), voci);
    assert.equal(decrypt(String(voceDb(d, propria).encrypted_password)), "nuova");
  });

  it("voce condivisa e password vuota: rifiutato (la voce nuova ha bisogno del segreto)", () => {
    const d = nuovoDb();
    const condivisa = voce(d, "admin di tutti", "ssh", { utente: "admin", segreto: "vecchia" });
    const A = apparato(d, "a", "ssh", 22);
    const B = apparato(d, "b", "ssh", 22);
    const bA = binding(d, A, condivisa, "ssh", 22);
    binding(d, B, condivisa, "ssh", 22);
    const r = rifiuto(() => aggiornaSegretoBindingDb(d, A, bA, { username: "altro", password: "" }));
    assert.equal(r.stato, 400);
    assert.equal(bindingDi(d, A)[0].credential_id, condivisa);
  });

  it("binding inline rimasto (apparato lasciato dalla 2e): diventa voce, col segreto che aveva se non se ne scrive uno", () => {
    const d = nuovoDb();
    const S = apparato(d, "vecchio", "ssh", 22);
    const b = binding(d, S, null, "ssh", 22, { utenteInline: "root", segretoInline: encrypt("pw") });
    const esito = aggiornaSegretoBindingDb(d, S, b, { username: "root" });
    const v = voceDb(d, esito.credential_id);
    assert.equal(decrypt(String(v.encrypted_password)), "pw");
    assert.deepEqual([bindingDi(d, S)[0].inline_username, bindingDi(d, S)[0].inline_encrypted_password], [null, null]);
  });

  it("delete di un binding di un altro apparato: rifiutato (la rotta risponde 404), il binding resta", () => {
    const d = nuovoDb();
    const ssh = voce(d, "ssh", "ssh", { utente: "u", segreto: "p" });
    const A = apparato(d, "a", "ssh", 22);
    const B = apparato(d, "b", "ssh", 22);
    const bB = binding(d, B, ssh, "ssh", 22);
    assert.equal(eliminaBindingApparatoDb(d, A, bB), false);
    assert.equal(bindingDi(d, B).length, 1);
    assert.equal(eliminaBindingApparatoDb(d, B, bB), true);
    assert.equal(bindingDi(d, B).length, 0);
  });

  it("modifica di un binding di un altro apparato: 404", () => {
    const d = nuovoDb();
    const ssh = voce(d, "ssh", "ssh", { utente: "u", segreto: "p" });
    const A = apparato(d, "a", "ssh", 22);
    const B = apparato(d, "b", "ssh", 22);
    const bB = binding(d, B, ssh, "ssh", 22);
    assert.equal(rifiuto(() => aggiornaSegretoBindingDb(d, A, bB, { username: "x", password: "y" })).stato, 404);
  });
});

// ── «Usata adesso» ──────────────────────────────────────────────────────────

describe("«Usata adesso»: la scelta del motore, non le colonne", () => {
  it("binding fallito saltato (D10): mostra quello non provato che lo sostituisce; non scrive ripieghi", () => {
    const d = nuovoDb();
    const rotta = voce(d, "rotta", "ssh", { utente: "u", segreto: "p" });
    const buona = voce(d, "buona", "ssh", { utente: "u", segreto: "q" });
    const comm = voce(d, "comm", "snmp", { segreto: "c0mm" });
    const S = apparato(d, "sw", "ssh", 22);
    binding(d, S, rotta, "ssh", 22, { ordine: 0, stato: "failed" });
    binding(d, S, buona, "ssh", 22, { ordine: 1 });
    binding(d, S, comm, "snmp", 161, { ordine: 2 });
    const primaRipieghi = JSON.stringify(riepilogoRipieghi());

    const righe = usataAdessoDb(d, S);

    assert.deepEqual(
      righe.map((r) => [r.ruolo, r.protocollo, r.credential_id, r.nome, r.fonte, r.porta]),
      [
        ["principale", "ssh", buona, "buona", "device_binding", 22],
        ["snmp", "snmp", comm, "comm", "device_binding", 161],
      ],
    );
    assert.equal(JSON.stringify(riepilogoRipieghi()), primaRipieghi, "la vista non registra ripieghi");
  });

  it("nessuna credenziale: la riga dice «nessuna» col motivo", () => {
    const d = nuovoDb();
    const S = apparato(d, "srv", "winrm", 5985);
    const [r] = usataAdessoDb(d, S);
    assert.equal(r.credential_id, null);
    assert.equal(r.fonte, null);
    assert.match(String(r.motivo), /Nessuna credenziale WinRM/);
  });

  it("apparato SNMP: una riga sola, quella SNMP", () => {
    const d = nuovoDb();
    const comm = voce(d, "comm", "snmp", { segreto: "c0mm" });
    const S = apparato(d, "sw", "snmp_v2", 22);
    binding(d, S, comm, "snmp", 161);
    assert.deepEqual(usataAdessoDb(d, S).map((r) => [r.ruolo, r.protocollo, r.credential_id]), [["principale", "snmp", comm]]);
  });
});
