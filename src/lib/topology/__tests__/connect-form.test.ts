import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PORT_MANUAL,
  PORT_NONE,
  buildLinkPatch,
  buildManualLink,
  initialPort,
  portChoices,
  type KnownPort,
} from "@/lib/topology/connect-form";

const port = (name: string, over: Partial<KnownPort> = {}): KnownPort => ({ name, speed: null, poeW: null, kind: "switch_port", note: null, ...over });

test("le porte note diventano voci leggibili, in ordine naturale, senza doppi; in fondo «porta non nota» e «scrivi a mano»", () => {
  const out = portChoices([
    port("Port 10", { speed: "1000 Mbps", poeW: 7.5 }),
    port("Port 2", { speed: "10G", note: "uplink" }),
    port("Port 2"),
    port("eno1", { kind: "hypervisor_nic", speed: "1000", note: "membro di bond0" }),
  ]);
  assert.deepEqual(out, [
    { value: "Port 2", label: "Port 2 · 10G · uplink" },
    { value: "Port 10", label: "Port 10 · 1G · ⚡ 7,5 W" },
    { value: "eno1", label: "eno1 · 1G · membro di bond0" },
    { value: PORT_NONE, label: "porta non nota" },
    { value: PORT_MANUAL, label: "✎ scrivi a mano…" },
  ]);
});

test("la scelta iniziale: la porta salvata se è fra le note, altrimenti scritta a mano; vuota = non nota", () => {
  const ports = [port("Port 1"), port("Port 2")];
  assert.deepEqual(initialPort(ports, "Port 2"), { choice: "Port 2", text: "" });
  assert.deepEqual(initialPort(ports, "ether7"), { choice: PORT_MANUAL, text: "ether7" });
  assert.deepEqual(initialPort(ports, ""), { choice: PORT_NONE, text: "" });
});

test("il corpo del collegamento a mano: porte dalla scelta o dal testo, tipo e nota; errori in italiano", () => {
  const ok = buildManualLink({
    a: "dev:1", b: "dev:9", aPort: { choice: "Port 5", text: "" }, bPort: { choice: PORT_MANUAL, text: "  eno2 " }, medium: "fibra", note: "  ",
  });
  assert.deepEqual(ok, {
    ok: true,
    body: { action: "add", a_node: "dev:1", a_port: "Port 5", b_node: "dev:9", b_port: "eno2", medium: "fibra", note: null },
  });
  const none = buildManualLink({ a: "dev:1", b: "dev:9", aPort: { choice: PORT_NONE, text: "x" }, bPort: { choice: PORT_NONE, text: "" }, medium: null, note: "armadio 2" });
  assert.deepEqual(none.ok && none.body, { action: "add", a_node: "dev:1", a_port: "", b_node: "dev:9", b_port: "", medium: null, note: "armadio 2" });
  assert.deepEqual(buildManualLink({ a: "dev:1", b: "dev:1", aPort: { choice: PORT_NONE, text: "" }, bPort: { choice: PORT_NONE, text: "" }, medium: null, note: "" }), {
    ok: false, error: "Un collegamento unisce due oggetti diversi",
  });
  const long = buildManualLink({ a: "dev:1", b: "dev:2", aPort: { choice: PORT_MANUAL, text: "x".repeat(101) }, bPort: { choice: PORT_NONE, text: "" }, medium: null, note: "" });
  assert.deepEqual(long, { ok: false, error: "Porta troppo lunga (massimo 100 caratteri)" });
  const empty = buildManualLink({ a: "dev:1", b: "dev:2", aPort: { choice: PORT_MANUAL, text: "  " }, bPort: { choice: PORT_NONE, text: "" }, medium: null, note: "" });
  assert.deepEqual(empty, { ok: false, error: "Scrivi la porta di partenza, o scegli «porta non nota»" });
});

test("la modifica: stesse regole, solo porte, tipo e nota", () => {
  assert.deepEqual(
    buildLinkPatch({ aPort: { choice: "Port 3", text: "" }, bPort: { choice: PORT_NONE, text: "" }, medium: "wireless", note: "ponte" }),
    { ok: true, body: { a_port: "Port 3", b_port: "", medium: "wireless", note: "ponte" } },
  );
});
