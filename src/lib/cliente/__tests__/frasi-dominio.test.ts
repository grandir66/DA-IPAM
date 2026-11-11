/**
 * Le frasi semplici dei rilievi del dominio. L'11/11/2026 in «Cosa richiede attenzione» della vista
 * cliente uscivano i titoli delle regole, in inglese («Shadow credentials (KeyCredentialLink) present»),
 * e un rilievo che non è un difetto («0 · Domain score»).
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/frasi-dominio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { conQuanti, fraseRilievo, regoleConFrase, rilievoNascosto } from "../frasi-dominio";
import { statoDominio } from "../schede/dominio";

test("una regola in elenco ha la sua frase, una fuori elenco resta col titolo", () => {
  assert.equal(fraseRilievo("DA-A-ShadowCredentials", "Shadow credentials (KeyCredentialLink) present"), "Account con una chiave di accesso aggiunta di nascosto");
  assert.equal(fraseRilievo("DA-X-Nuova", "Titolo della regola nuova"), "Titolo della regola nuova");
  assert.equal(fraseRilievo(null, "Senza identificativo"), "Senza identificativo");
});

test("il punteggio e gli avvisi di lettura non sono rilievi per il cliente", () => {
  assert.equal(rilievoNascosto("DA-A-DomainScore"), true);
  assert.equal(rilievoNascosto("DA-A-AclCollectPartial"), true);
  assert.equal(rilievoNascosto("DA-P-DCSyncRights"), false);
  assert.equal(rilievoNascosto(null), false);
});

test("con zero oggetti il conto non si scrive", () => {
  assert.equal(conQuanti(9, "Frase"), "9 · Frase");
  assert.equal(conQuanti(0, "Frase"), "Frase");
});

test("nessuna frase contiene le parole che al cliente non si mostrano", () => {
  const vietate = /\b(ACL|ACE|LDAP|SMB|NTLM|Kerberos|krbtgt|GPO|SID|DCSync|LAPS|ESC\d|KeyCredentialLink|AdminSDHolder)\b/i;
  for (const regola of regoleConFrase()) {
    const frase = fraseRilievo(regola, "");
    assert.ok(frase.length > 0, regola);
    assert.ok(!vietate.test(frase), `${regola}: ${frase}`);
  }
});

test("statoDominio: i rilievi escono con la frase e senza quelli nascosti", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ad_health_runs (id INTEGER PRIMARY KEY, started_at TEXT, status TEXT, score_global INTEGER,
      score_stale INTEGER, score_privileged INTEGER, score_trust INTEGER, score_anomaly INTEGER);
    CREATE TABLE ad_health_findings (id INTEGER PRIMARY KEY, run_id INTEGER, rule_id TEXT, severity TEXT,
      title TEXT, object_count INTEGER, sample_dns_json TEXT);
    INSERT INTO ad_health_runs VALUES (1, '2026-11-10T16:58:34.709Z', 'ok', 100, 50, 100, 0, 100);
    INSERT INTO ad_health_findings VALUES (1, 1, 'DA-A-DomainScore', 'Critical', 'Domain score', 0, '[]');
    INSERT INTO ad_health_findings VALUES (2, 1, 'DA-P-DCSyncRights', 'Critical', 'Unexpected DCSync rights on domain', 4, '[]');
    INSERT INTO ad_health_findings VALUES (3, 1, 'DA-A-LdapSigningOff', 'High', 'LDAP signing not required on DC', 0, '[]');
  `);
  const stato = statoDominio(db);
  assert.ok(stato);
  assert.deepEqual(stato.rilievi.map((r) => r.testo), [
    "Account che possono copiare tutte le password del dominio senza averne motivo",
    "I server di dominio accettano richieste non firmate",
  ]);
  assert.equal(stato.graviTotali, 2);
});
