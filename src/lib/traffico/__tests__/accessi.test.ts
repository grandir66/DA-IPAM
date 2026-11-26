/**
 * Tappa 7, ZONA ROSSA (2026-11-23): gli accessi coi nomi utente. Spenti di serie; validi solo se puliti;
 * lo stesso accesso da due collector si prende al massimo; dopo 90 giorni vanno via.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/accessi.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { dbTraffico } from "@/lib/traffico/lettura";
import { accessiAccesi, accessoValido, elencoAccessi, impostaAccessi, registraAccessi, sfoltisciAccessi, type AccessoCollector } from "@/lib/traffico/accessi";

const T = "TRAFFACC2311";
after(() => { closeTenantDb(T); deleteTenantDatabase(T); closeHubDb(); });

const oggi = new Date().toISOString().slice(0, 19).replace("T", " ");
const riga = (extra: Partial<AccessoCollector> = {}): AccessoCollector => ({
  seq: 1, inizio: oggi, client: "10.4.0.10", server: "10.4.0.1", protocollo: "smb", utente: "prova", dominio: "BANCO", esito: "riuscito", volte: 2, ...extra,
});

test("una riga storta si scarta intera: protocollo ignoto, nome con caratteri di controllo, esito inventato", () => {
  assert.equal(accessoValido(riga()), true);
  assert.equal(accessoValido(riga({ protocollo: "ftp" })), false);
  assert.equal(accessoValido(riga({ utente: "pro\u0001va" })), false);
  assert.equal(accessoValido(riga({ esito: "forse" })), false);
  assert.equal(accessoValido(riga({ utente: "x".repeat(129) })), false);
});

test("spento di serie; due collector al massimo; ricerca; 90 giorni", () => {
  withTenant(T, () => {
    assert.equal(accessiAccesi(), false);
    impostaAccessi(true);
    assert.equal(accessiAccesi(), true);
    const d = dbTraffico();
    registraAccessi(d, 1, [riga(), riga({ esito: "fallito", volte: 1 })]);
    registraAccessi(d, 2, [riga()]);                       // lo stesso accesso visto da un altro collector
    registraAccessi(d, 1, [riga({ utente: "altro", seq: 2 })]);
    const e = elencoAccessi(d, { giorni: 7 });
    const prova = e.righe.find((r) => r.utente === "prova");
    assert.deepEqual([prova?.riusciti, prova?.falliti], [2, 1]);
    assert.equal(elencoAccessi(d, { giorni: 7, cerca: "alt" }).totale, 1);
    d.prepare("UPDATE traffico_accessi SET giorno = '2020-01-01' WHERE utente = 'altro'").run();
    sfoltisciAccessi(d);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_accessi WHERE utente = 'altro'").get() as { n: number }).n, 0);
    impostaAccessi(false);
    assert.equal(accessiAccesi(), false);
  });
});
