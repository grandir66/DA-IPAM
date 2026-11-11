/**
 * Gli apparati creati da soli entrano in un job «Lettura apparati» loro (11/11/2026): sull'hub 533, il giorno dopo la
 * prima creazione, ne risultava letto 1 su 19 perché nessun job li conteneva.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/letture-automatiche.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { JobApparatiScelti, MAX_APPARATI } from "@/lib/apparati-scelti/regole";
import { aggiungiAlleLettureAutomatiche, NOME_JOB_LETTURE } from "../letture-automatiche";

let db: Database.Database;
const job = () => (db.prepare("SELECT id, interval_minutes, enabled, config FROM scheduled_jobs ORDER BY id").all() as Array<{ id: number; interval_minutes: number; enabled: number; config: string }>)
  .map((j) => ({ ...j, config: JSON.parse(j.config) as { nome: string; device_ids: number[]; cosa: Record<string, boolean>; ora?: string } }));

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE scheduled_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER, job_type TEXT, interval_minutes INTEGER,
           last_run TEXT, next_run TEXT, enabled INTEGER DEFAULT 1, config TEXT, created_at TEXT, updated_at TEXT)`);
});

describe("job delle letture automatiche", () => {
  it("il primo apparato crea il job: giornaliero, acceso, sole informazioni, forma accettata dalle rotte", () => {
    const toccati = aggiungiAlleLettureAutomatiche(db, [44, 45]);
    const [j] = job();
    assert.deepEqual(toccati, [j.id]);
    assert.equal(j.config.nome, NOME_JOB_LETTURE);
    assert.deepEqual(j.config.device_ids, [44, 45]);
    assert.deepEqual(j.config.cosa, { info: true, porte_mac: false, vlan: false });
    assert.equal(j.enabled, 1);
    assert.ok(JobApparatiScelti.safeParse({ interval_minutes: j.interval_minutes, config: j.config }).success);
  });
  it("i successivi si aggiungono allo stesso job, senza doppioni", () => {
    aggiungiAlleLettureAutomatiche(db, [44]);
    aggiungiAlleLettureAutomatiche(db, [44, 46]);
    assert.equal(job().length, 1);
    assert.deepEqual(job()[0].config.device_ids, [44, 46]);
  });
  it("un apparato già letto da un job di una persona non si aggiunge", () => {
    db.prepare("INSERT INTO scheduled_jobs (job_type, interval_minutes, config) VALUES ('apparati_scelti', 240, ?)")
      .run(JSON.stringify({ nome: "Switch e router del CED", device_ids: [1, 7], cosa: { info: true, porte_mac: true, vlan: true } }));
    assert.deepEqual(aggiungiAlleLettureAutomatiche(db, [7]), []);
    assert.equal(job().length, 1);
  });
  it("oltre il tetto si apre un secondo job col numero", () => {
    aggiungiAlleLettureAutomatiche(db, Array.from({ length: MAX_APPARATI + 3 }, (_, i) => 100 + i));
    const j = job();
    assert.equal(j.length, 2);
    assert.equal(j[0].config.device_ids.length, MAX_APPARATI);
    assert.equal(j[1].config.nome, `${NOME_JOB_LETTURE} (2)`);
    assert.equal(j[1].config.device_ids.length, 3);
  });
});
