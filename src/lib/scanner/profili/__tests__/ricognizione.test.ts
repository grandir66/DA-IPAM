/** Ricognizione delicata (06/11/2026): il comando non fa niente più delle porte, e chi è di campo o sconosciuto non le riceve. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { argomentiTcp, argomentiUdp } from "@/lib/scanner/profili/comando";
import { PROFILO_RICOGNIZIONE, scegliRicognizione, unisciPorte } from "@/lib/scanner/profili/ricognizione";
import { PORTE_DI_CAMPO } from "@/lib/scanner/profili/sconosciuti";

const opts = { privilegi: true, disponibili: null };

test("il comando è solo porte: niente -sV, -O, script, e lento", () => {
  const a = argomentiTcp(PROFILO_RICOGNIZIONE, opts);
  for (const vietato of ["-sV", "-O", "--script", "-T4", "--min-rate"]) assert.ok(!a.includes(vietato), vietato);
  assert.ok(a.includes("-T2"));
  assert.ok(a.includes("-sT"));
  assert.equal(argomentiUdp(PROFILO_RICOGNIZIONE, opts), null);
});

test("nessuna porta di campo né la 9100 fra quelle provate", () => {
  for (const p of [...PORTE_DI_CAMPO, 9100]) assert.ok(!PROFILO_RICOGNIZIONE.tcp.includes(p), String(p));
  assert.ok(PROFILO_RICOGNIZIONE.tcp.includes(443));
});

test("porte solo a chi ha un costruttore non di campo; spenti fuori", () => {
  const s = scegliRicognizione([
    { network_id: 1, ip: "1.1.1.1", vendor: "Dell Inc.", status: "online" },
    { network_id: 1, ip: "1.1.1.2", vendor: "CREVIS Co., Ltd", status: "online" },
    { network_id: 1, ip: "1.1.1.3", classification: "plc", vendor: "Dell Inc.", status: "online" },
    { network_id: 1, ip: "1.1.1.4", status: "online" },
    { network_id: 1, ip: "1.1.1.5", vendor: "Microchip Technology", status: "online" },
    { network_id: 1, ip: "1.1.1.6", vendor: "Dell Inc.", status: "offline" },
  ]);
  assert.deepEqual(s.daProvare, ["1.1.1.1"]);
  assert.deepEqual(s.passivi, [
    { ip: "1.1.1.2", motivo: "impianto" },
    { ip: "1.1.1.3", motivo: "impianto" },
    { ip: "1.1.1.4", motivo: "senza_costruttore" },
    { ip: "1.1.1.5", motivo: "impianto" },
  ]);
});

test("una riga già nota con la versione non si perde", () => {
  const note = [{ port: 22, protocol: "tcp", service: "ssh", version: "OpenSSH 9" }];
  const u = unisciPorte(note, [{ port: 22, protocol: "tcp" }, { port: 443, protocol: "tcp" }]);
  assert.equal(u.length, 2);
  assert.equal(u[0].version, "OpenSSH 9");
});
