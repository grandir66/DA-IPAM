/**
 * Credenziali agganciate da sole alle reti (Riccardo, 08/11/2026): «quando si crea una network nuova le credenziali
 * già registrate vanno aggiunte da sole alla rete; quando si aggiunge una credenziale nuova va agganciata anche alle
 * reti esistenti». Sull'hub 533, quel giorno: 7 reti, 13 voci d'accesso registrate, 5 agganciate.
 *
 * Anche le voci Windows, per decisione di Riccardo dello stesso giorno («Sì, anche Windows»); AD resta fuori.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/aggancio-reti.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { creaRete } from "@/lib/networks/salva-rete";
import { creaVoceDb } from "../archivio";
import { agganciaATutteLeRetiDb } from "../lista-rete";

const T = "TESTAGGANCIORETI";
const dbt = () => getTenantDb(T);

function voce(nome: string, tipo: string): number {
  return Number(dbt()
    .prepare(`INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)`)
    .run(nome, tipo, encrypt("utente"), encrypt("segreto")).lastInsertRowid);
}

const lista = (networkId: number) =>
  (dbt().prepare(`SELECT credential_id FROM network_credentials WHERE network_id = ? ORDER BY sort_order`).all(networkId) as Array<{ credential_id: number }>).map((r) => r.credential_id);

let ssh = 0, snmp = 0, win = 0, ad = 0;

before(() => withTenant(T, () => {
  ssh = voce("ssh", "ssh");
  snmp = voce("snmp", "snmp");
  win = voce("win", "windows");
  ad = voce("ad", "ad");
}));
after(() => deleteTenantDatabase(T));

describe("rete nuova", () => {
  it("senza una lista scelta nasce con le voci registrate SSH/SNMP/Windows/API, non AD", () => withTenant(T, () => {
    const r = creaRete({ cidr: "10.81.1.0/24", name: "auto", description: "", location: "" });
    assert.deepEqual(lista(r.id), [ssh, snmp, win]);
    assert.ok(!lista(r.id).includes(ad));
  }));

  it("con una lista scelta (anche vuota) vale quella: chi ne toglie una la toglie", () => withTenant(T, () => {
    const a = creaRete({ cidr: "10.81.2.0/24", name: "scelta", description: "", location: "", credential_ids: [win] });
    assert.deepEqual(lista(a.id), [win]);
    const b = creaRete({ cidr: "10.81.3.0/24", name: "vuota", description: "", location: "", credential_ids: [] });
    assert.deepEqual(lista(b.id), []);
  }));
});

describe("credenziale nuova", () => {
  it("SSH: in coda a ogni rete esistente, l'ordine di prima resta", () => withTenant(T, () => {
    const reti = (dbt().prepare(`SELECT id FROM networks ORDER BY id`).all() as Array<{ id: number }>).map((r) => r.id);
    const prima = reti.map(lista);
    const esito = creaVoceDb(dbt(), { name: "ssh nuova", credential_type: "ssh", auth_method: "password", username: "u", password: "p" });
    assert.ok(esito.ok, esito.ok ? "" : esito.errore);
    const id = esito.vista.id;
    assert.equal(esito.reti_agganciate, reti.length);
    reti.forEach((r, i) => assert.deepEqual(lista(r), [...prima[i], id]));
  }));

  it("Windows: si aggancia anche lei a ogni rete", () => withTenant(T, () => {
    const reti = (dbt().prepare(`SELECT COUNT(*) AS n FROM networks`).get() as { n: number }).n;
    const esito = creaVoceDb(dbt(), { name: "win nuova", credential_type: "windows", username: "DOM\\u", password: "p" });
    assert.ok(esito.ok, esito.ok ? "" : esito.errore);
    assert.equal(esito.reti_agganciate, reti);
  }));

  it("AD: non si aggancia mai", () => withTenant(T, () => {
    const id = voce("ad nuova", "ad");
    assert.equal(agganciaATutteLeRetiDb(dbt(), id, "ad"), 0);
    const n = dbt().prepare(`SELECT COUNT(*) AS n FROM network_credentials WHERE credential_id = ?`).get(id) as { n: number };
    assert.equal(n.n, 0);
  }));
});
