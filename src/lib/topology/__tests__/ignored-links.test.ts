// «Ignora» si annulla dalla pagina (revisione finale, minore rinviato del Task F): l'elenco «Collegamenti
// ignorati» di «Dati della mappa» dice in parole quali oggetti e quali porte, chi e quando. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IGNORA_SI_ANNULLA, ignoredLinkRows, SOLO_ADMIN_RIPRISTINA } from "@/lib/topology/ignored-links";
import type { MapNode } from "@/lib/topology/model-types";

function node(id: string, name: string): MapNode {
  const [k, n] = id.split(":");
  return {
    id, kind: k === "dev" ? "device" : "host", refId: Number(n), name, type: "switch", mgmtIp: null, fusedHostIds: [], addresses: [],
    aliases: [], siteId: null, rackId: null, siteProposed: false, hidden: false, vendor: null,
  };
}
const riga = (id: number, action: "add" | "ignore", a: string, aPort: string, b: string, bPort: string, at = "2026-10-13 22:51:06") => ({
  id, action, a_node: a, a_port: aPort, b_node: b, b_port: bPort, created_by: "riccardo", created_at: at,
});

test("solo gli «ignora», i più recenti prima; nomi e porte in parole; data in ora italiana", () => {
  const model = { nodes: [node("dev:1", "RTR-1"), node("dev:2", "SW-2"), node("dev:9", "SRV-9")], canonical: { "host:7": "dev:9" } };
  const r = ignoredLinkRows(
    [
      riga(3, "ignore", "dev:1", "ether2", "dev:2", "Port 5"),
      riga(4, "add", "dev:1", "ether3", "dev:2", "Port 6"),
      riga(5, "ignore", "host:7", "", "dev:12", "eth0", "2026-10-14 06:00:00"),
    ],
    model,
  );
  assert.deepEqual(r, [
    { id: 5, a: "SRV-9", aPort: "porta non indicata", b: "oggetto non più nella mappa (dev:12)", bPort: "porta eth0", by: "riccardo", when: "14/10/2026, 08:00" },
    { id: 3, a: "RTR-1", aPort: "porta ether2", b: "SW-2", bPort: "porta Port 5", by: "riccardo", when: "14/10/2026, 00:51" },
  ]);
  assert.deepEqual(ignoredLinkRows([], model), []);
});

test("il dialogo di «Ignora» dice dove si annulla; chi non è admin legge il perché", () => {
  assert.match(IGNORA_SI_ANNULLA, /Dati della mappa/);
  assert.match(IGNORA_SI_ANNULLA, /Ripristina/);
  assert.match(SOLO_ADMIN_RIPRISTINA, /amministratore/);
});
