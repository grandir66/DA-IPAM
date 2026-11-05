import { test } from "node:test";
import assert from "node:assert/strict";
import { etichettaGiro, giriDelCliente, giroDelCliente, jobInEsecuzione } from "../giri";
import type { ScanProgress } from "@/types";

function giro(p: Partial<ScanProgress> & { id: string }): ScanProgress {
  return {
    network_id: 1,
    scan_type: "fast",
    status: "running",
    total: 10,
    scanned: 1,
    found: 0,
    phase: "Ping",
    started_at: "2026-11-05T10:00:00.000Z",
    logs: ["riga"],
    tenant_code: "A",
    ...p,
  };
}

test("stessa rete in due clienti: ognuno vede solo il suo giro", () => {
  const giri = [giro({ id: "a", tenant_code: "A" }), giro({ id: "b", tenant_code: "B" })];
  assert.deepEqual(giriDelCliente(giri, "A").map((g) => g.id), ["a"]);
  assert.deepEqual(giriDelCliente(giri, "B").map((g) => g.id), ["b"]);
});

test("un giro senza cliente, o una sessione senza tenant, non si vedono", () => {
  assert.equal(giroDelCliente(giro({ id: "a", tenant_code: undefined }), "A"), false);
  assert.equal(giroDelCliente(giro({ id: "a" }), null), false);
});

test("l'elenco mette prima i giri in corso, poi i più recenti, e toglie log e cliente", () => {
  const elenco = giriDelCliente(
    [
      giro({ id: "finito-nuovo", status: "completed", started_at: "2026-11-05T12:00:00.000Z" }),
      giro({ id: "corso-vecchio", started_at: "2026-11-05T09:00:00.000Z" }),
      giro({ id: "corso-nuovo", started_at: "2026-11-05T11:00:00.000Z" }),
      giro({ id: "fallito-vecchio", status: "failed", started_at: "2026-11-05T08:00:00.000Z" }),
    ],
    "A",
  );
  assert.deepEqual(elenco.map((g) => g.id), ["corso-nuovo", "corso-vecchio", "finito-nuovo", "fallito-vecchio"]);
  assert.equal("logs" in elenco[0], false);
  assert.equal("tenant_code" in elenco[0], false);
});

test("il job di una rete con un giro in corso si tace, gli altri si vedono", () => {
  const giri = giriDelCliente([giro({ id: "a", network_id: 7 })], "A");
  const jobs = [
    { id: 1, network_id: 7 },
    { id: 2, network_id: 8 },
    { id: 3, network_id: null },
    { id: 4, network_id: null },
  ];
  const elenco = jobInEsecuzione(jobs, (id) => id !== 4, giri, (id) => `job ${id}`);
  assert.deepEqual(elenco, [{ id: 2, nome: "job 2" }, { id: 3, nome: "job 3" }]);
});

test("un giro finito non occupa la rete: il suo job si vede", () => {
  const giri = giriDelCliente([giro({ id: "a", network_id: 7, status: "completed" })], "A");
  const elenco = jobInEsecuzione([{ id: 1, network_id: 7 }], () => true, giri, () => "job");
  assert.equal(elenco.length, 1);
});

test("un tipo sconosciuto o un'interrogazione di apparato tengono il loro nome", () => {
  assert.equal(etichettaGiro("scan_full"), "Scansione completa");
  assert.equal(etichettaGiro("Proxmox VE — pve"), "Proxmox VE — pve");
});
