// «Ignora» si annulla dalla pagina (revisione finale, minore rinviato del Task F): l'elenco «Collegamenti
// ignorati» di «Dati della mappa» dice in parole quali oggetti e quali porte, chi e quando. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caviFra, IGNORA_SI_ANNULLA, ignoredLinkRows, ORFANA, SOLO_ADMIN_RIPRISTINA, testiIgnoraCavo } from "@/lib/topology/ignored-links";
import { LINK_ATTRS_DEFAULT, type MapLink, type MapNode } from "@/lib/topology/model-types";

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
  // Spec §13.9 (T1): ogni riga dice se è orfana; qui il modello non ha `correzioniOrfane`, quindi nessuna lo è.
  assert.deepEqual(r, [
    { id: 5, a: "SRV-9", aPort: "porta non indicata", b: "oggetto non più nella mappa (dev:12)", bPort: "porta eth0", by: "riccardo", when: "14/10/2026, 08:00", orfana: false },
    { id: 3, a: "RTR-1", aPort: "porta ether2", b: "SW-2", bPort: "porta Port 5", by: "riccardo", when: "14/10/2026, 00:51", orfana: false },
  ]);
  assert.deepEqual(ignoredLinkRows([], model), []);
});

test("il dialogo di «Ignora» dice dove si annulla; chi non è admin legge il perché", () => {
  assert.match(IGNORA_SI_ANNULLA, /Dati della mappa/);
  assert.match(IGNORA_SI_ANNULLA, /Ripristina/);
  assert.match(SOLO_ADMIN_RIPRISTINA, /amministratore/);
});

// Spec §13.9: «Ignora» toglie il cavo con le sue porte; una correzione che non corrisponde a nessun cavo non toglie niente
// e si vede (la riga del 14/10 del cliente A), con «Togli la correzione» e «Scegli il cavo da ignorare…».
test("il dialogo dell'«Ignora» dice quale cavo, con le porte, e che gli altri cavi restano", () => {
  const t = testiIgnoraCavo("CORE-1", "Port 10", "RTR-1", "sfp-sfpplus1", "uplink UniFi + LLDP");
  assert.equal(t.titolo, "Ignorare il cavo CORE-1 · Port 10 ↔ RTR-1 · sfp-sfpplus1?");
  assert.equal(t.testo, "Questo cavo sparisce da tutte le mappe, anche se le letture continuano a vederlo (uplink UniFi + LLDP). Gli altri cavi fra CORE-1 e RTR-1, se ci sono, restano. I dati letti non si toccano.");
  assert.equal(testiIgnoraCavo("A", "", "B", "eth0", "x").titolo, "Ignorare il cavo A · porta non nota ↔ B · eth0?");
});

test("le righe orfane si riconoscono: «non corrisponde a nessun cavo visto: non toglie niente»", () => {
  const model = { nodes: [node("dev:1", "RTR-1"), node("dev:114", "CORE-1")], canonical: {}, correzioniOrfane: [1] };
  const r = ignoredLinkRows([riga(1, "ignore", "dev:114", "porta-10", "dev:1", "ether8"), riga(2, "ignore", "dev:1", "ether3", "dev:114", "")], model);
  assert.deepEqual(r.map((x) => [x.id, x.orfana]), [[2, false], [1, true]]);
  assert.equal(ORFANA, "non corrisponde a nessun cavo visto: non toglie niente");
});

test("Scegli il cavo da ignorare…: la linea e gli altri cavi visti fra i due oggetti, con le porte orientate come la correzione", () => {
  const l: MapLink = {
    id: "link:dev:1|dev:114", a: "dev:114", aPort: "Port 10", b: "dev:1", bPort: "sfp-sfpplus1", source: "unifi_uplink", sources: ["unifi_uplink", "lldp"],
    uplinkFrom: "dev:114", lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
    altriCavi: [{ aPort: "Port 16", bPort: "ether2", sources: ["lldp"], lastSeen: null }],
  };
  assert.deepEqual(caviFra({ links: [l], canonical: {} }, "dev:1", "host:5"), []);
  assert.deepEqual(caviFra({ links: [l], canonical: {} }, "dev:1", "dev:114"), [
    { aPort: "sfp-sfpplus1", bPort: "Port 10", parole: "la linea sulla mappa · uplink UniFi + LLDP", linea: true },
    { aPort: "ether2", bPort: "Port 16", parole: "altro cavo visto · LLDP", linea: false },
  ]);
});
