// Abbinamento host del centro ↔ DA-IPAM (§5 del design dell'API), funzione pura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostDelCentro } from "../api";
import { abbina, nomeCorto, type HostIpam } from "../abbinamento";

function h(id: string, ips: string[], extra: Record<string, unknown> = {}) {
  return HostDelCentro.parse({
    hostid: id,
    nome: `Apparato ${id}`,
    host: `apparato-${id}`,
    ip: ips,
    ip_condiviso: false,
    proxy: "12345-zbx",
    disponibilita: { complessiva: "si" },
    dati_affidabili: true,
    ...extra,
  });
}
function ipam(...righe: HostIpam[]): Map<string, HostIpam[]> {
  const m = new Map<string, HostIpam[]>();
  for (const r of righe) m.set(r.ip, [...(m.get(r.ip) ?? []), r]);
  return m;
}

test("nessun host in DA-IPAM con quell'IP → nessuno; host senza IP → nessuno", () => {
  const r = abbina([h("1", ["192.0.2.1"]), h("2", [])], new Map(), []);
  assert.equal(r.perHost.get("1")!.stato, "nessuno");
  assert.equal(r.perHost.get("2")!.stato, "nessuno");
});

test("IP unico di qua e di là → proposto; il nome è solo un indizio", () => {
  const r = abbina([h("1", ["192.0.2.1"])], ipam({ id: 5, ip: "192.0.2.1", nome: "APPARATO-1.esempio.lan" }), []);
  const e = r.perHost.get("1")!;
  assert.ok(e.stato === "proposto" && e.hostId === 5 && e.nomeCoincide);
  const r2 = abbina([h("1", ["192.0.2.1"])], ipam({ id: 5, ip: "192.0.2.1", nome: "tutt'altro" }), []);
  const e2 = r2.perHost.get("1")!;
  assert.ok(e2.stato === "proposto" && !e2.nomeCoincide, "nome diverso: proposto lo stesso, senza indizio");
});

test("il nome da solo non abbina mai", () => {
  const r = abbina([h("1", ["192.0.2.1"])], ipam({ id: 5, ip: "192.0.2.77", nome: "apparato-1" }), []);
  assert.equal(r.perHost.get("1")!.stato, "nessuno");
});

test("ip_condiviso dal centro → ambiguo coi candidati, anche se DA-IPAM ha un solo host", () => {
  const r = abbina(
    [h("1", ["192.0.2.1"], { ip_condiviso: true }), h("2", ["192.0.2.1"], { ip_condiviso: true, proxy: "12345-zbx-2" })],
    ipam({ id: 5, ip: "192.0.2.1", nome: "x" }),
    [],
  );
  for (const id of ["1", "2"]) {
    const e = r.perHost.get(id)!;
    assert.ok(e.stato === "ambiguo" && e.motivo === "ip_condiviso");
    assert.equal(e.candidatiCentro.length, 2);
  }
});

test("lo stesso IP su due host nell'elenco anche se il centro non lo segna: ambiguo", () => {
  const r = abbina([h("1", ["192.0.2.1"]), h("2", ["192.0.2.1"])], new Map(), []);
  assert.equal(r.perHost.get("1")!.stato, "ambiguo");
});

test("un host con due IP che portano a due host diversi di DA-IPAM: ambiguo", () => {
  const r = abbina(
    [h("1", ["192.0.2.1", "192.0.2.2"])],
    ipam({ id: 5, ip: "192.0.2.1", nome: "a" }, { id: 6, ip: "192.0.2.2", nome: "b" }),
    [],
  );
  const e = r.perHost.get("1")!;
  assert.ok(e.stato === "ambiguo" && e.motivo === "ip_doppio_in_ipam" && e.candidatiIpam.length === 2);
});

test("verificato resta verificato anche se DA-IPAM ora ha l'IP doppio (non si ricalcola)", () => {
  const r = abbina(
    [h("1", ["192.0.2.1"])],
    ipam({ id: 5, ip: "192.0.2.1", nome: "a" }, { id: 6, ip: "192.0.2.1", nome: "b" }),
    [{ hostid: "1", hostId: 5, ip: "192.0.2.1", nome: "a" }],
  );
  assert.equal(r.perHost.get("1")!.stato, "verificato");
});

test("verificato con IP cambiato → perso; hostid sparito → nei persi; mai riabbinato a un altro", () => {
  const salvati = [
    { hostid: "1", hostId: 5, ip: "192.0.2.1", nome: "a" },
    { hostid: "3", hostId: 7, ip: "192.0.2.3", nome: "c" },
  ];
  const r = abbina([h("1", ["192.0.2.9"])], ipam({ id: 8, ip: "192.0.2.9", nome: "nuovo" }), salvati);
  const e = r.perHost.get("1")!;
  assert.ok(e.stato === "perso" && e.hostId === 5, "non diventa proposto verso l'host 8");
  assert.deepEqual(r.persi.map((p) => p.hostid), ["3"]);
});

test("forma corta del nome", () => {
  assert.equal(nomeCorto("SW-Piano.esempio.lan"), "sw-piano");
  assert.equal(nomeCorto(null), "");
});

test("misure leggibili; un valore mancante è «—», mai zero", async () => {
  const { formattaMisura } = await import("../pannello");
  assert.equal(formattaMisura("icmppingsec", 0.0021), "2,1 ms");
  assert.equal(formattaMisura("icmppingloss", 12.5), "12,5 %");
  assert.equal(formattaMisura("icmpping", 0), "non risponde");
  assert.equal(formattaMisura("system.uptime", 90_061), "1 g 1 h");
  assert.equal(formattaMisura("system.cpu.util", null), "—");
});
