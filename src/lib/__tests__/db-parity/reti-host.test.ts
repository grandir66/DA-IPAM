/**
 * Parità del dominio «reti e host» (NUC-2 gruppo 1b, T3-06).
 *
 * Le quattro funzioni con testo diverso nelle due copie sono confrontate con la
 * copia congelata della vecchia facciata: stesso valore, stesse tabelle.
 * `createNetwork` della facciata chiamava la semina dei job di `db-tenant`
 * attraverso un `require`; la copia tenant la chiama direttamente. Le altre
 * funzioni del dominio avevano lo stesso testo (e `recordHostHeartbeat` della
 * facciata era già una delega alla copia tenant): vale la prova d'identità.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/reti-host-vecchia-facciata";
import { HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito, stessoErrore } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const TABELLE = ["networks", "scheduled_jobs", "hosts", "excluded_ips"];
const ORA = ["created_at", "updated_at", "next_run", "last_run", "excluded_at"];

test("createNetwork: stessa rete e stessi job seminati", () => {
  const input = { cidr: "10.42.0.0/24", name: "Magazzino", gateway: "10.42.0.1", vlan_id: 30, description: "", location: "" };
  const e = stessoEsito({
    nome: "cn",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.createNetwork(input),
    tenant: () => tenant.createNetwork(input),
    funzioni: [vecchia.createNetwork, tenant.createNetwork],
    tabelle: TABELLE,
    colonneOra: ORA,
  });
  const job = (e.tabelleTenant.scheduled_jobs as Array<{ network_id: number | null }>).filter((j) => j.network_id === 3);
  assert.ok(job.length > 0, "la rete nuova riceve i job di controllo predefiniti");
});

test("createNetwork: rete sovrapposta, stesso errore", () => {
  const input = { cidr: "10.40.0.128/25", name: "Sovrapposta", description: "", location: "" };
  stessoErrore({
    nome: "cnerr",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.createNetwork(input),
    tenant: () => tenant.createNetwork(input),
    funzioni: [vecchia.createNetwork, tenant.createNetwork],
    tabelle: TABELLE,
  });
});

test("deleteHost: con esclusione dell'IP, senza, host assente", () => {
  const casi = [
    ["dh1", HOST.server, undefined],
    ["dh2", HOST.nas, { reason: "dismesso", excludedBy: "admin", skipExclusion: false }],
    ["dh3", HOST.pcAmmin, { skipExclusion: true }],
    ["dh4", 99, undefined],
  ] as const;
  for (const [nome, id, opzioni] of casi) {
    stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.deleteHost(id, opzioni),
      tenant: () => tenant.deleteHost(id, opzioni),
      funzioni: [vecchia.deleteHost, tenant.deleteHost],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("bulkDeleteHosts: host della rete, host di un'altra rete ignorati, elenco vuoto", () => {
  const casi = [
    ["bdh1", RETE_UFFICI, [HOST.pcAmmin, HOST.nas, HOST.srvDb], undefined],
    ["bdh2", RETE_UFFICI, [HOST.server], { skipExclusion: true }],
    ["bdh3", RETE_SERVER, [], undefined],
  ] as const;
  for (const [nome, rete, ids, opzioni] of casi) {
    stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.bulkDeleteHosts(rete, [...ids], opzioni),
      tenant: () => tenant.bulkDeleteHosts(rete, [...ids], opzioni),
      funzioni: [vecchia.bulkDeleteHosts, tenant.bulkDeleteHosts],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("noteHostsNonResponding: nota aggiunta, nota già presente oggi, host sconosciuto", () => {
  const scansionati = ["10.40.0.2", "10.40.0.20", "10.40.0.30", "10.40.0.99"];
  const e = stessoEsito({
    nome: "nhnr",
    fixture: (db) => {
      retiHostCredenziali(db);
      const oggi = new Date().toISOString().slice(0, 10);
      db.prepare("UPDATE hosts SET notes = ? WHERE id = ?").run(`[${oggi}] già annotato`, HOST.nas);
    },
    facciata: () => vecchia.noteHostsNonResponding(RETE_UFFICI, ["10.40.0.2"], [...scansionati, "10.40.0.40"], "ping"),
    tenant: () => tenant.noteHostsNonResponding(RETE_UFFICI, ["10.40.0.2"], [...scansionati, "10.40.0.40"], "ping"),
    funzioni: [vecchia.noteHostsNonResponding, tenant.noteHostsNonResponding],
    tabelle: ["hosts"],
    colonneOra: ORA,
  });
  const note = Object.fromEntries((e.tabelleTenant.hosts as Array<{ id: number; notes: string | null }>).map((h) => [h.id, h.notes]));
  assert.match(String(note[HOST.server]), /nota vecchia\n\[.*Non risposto \(ping\)/);
  assert.match(String(note[HOST.pcAmmin]), /^\[.*Non risposto \(ping\)/);
});
