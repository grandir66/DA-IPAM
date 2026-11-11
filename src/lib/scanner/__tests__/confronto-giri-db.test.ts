import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { StatoGiroRete } from "../confronto-giri";
import { leggiCambiRete, registraGiroRete } from "../confronto-giri-db";
import { parseNmapXml } from "../nmap";

const ip = "192.0.2.10";
const mac = "00:01:02:03:04:05";
const adesso = Date.UTC(2026, 10, 11);

function xmlTcp(stato: string, porte: string) {
  return `<nmaprun><host><status state="${stato}"/>
    <address addr="${ip}" addrtype="ipv4"/><address addr="${mac}" addrtype="mac"/>
    ${porte}
  </host></nmaprun>`;
}

function porta(numero: number, stato: string, protocollo = "tcp") {
  return `<port protocol="${protocollo}" portid="${numero}"><state state="${stato}"/></port>`;
}

test("Network Changes usa solo gli stati TCP espliciti e lascia intatto l'inventario Nmap", () => {
  const xml = xmlTcp("up", `<ports>${porta(22, "closed")}${porta(443, "open")}
    ${porta(8080, "open|filtered")}${porta(53, "open", "udp")}
    <extraports state="closed" count="15"/></ports>`);
  const [conOsservazione] = parseNmapXml(xml, { osservaTcp: true });
  const [comePrima] = parseNmapXml(xml);
  assert.deepEqual(conOsservazione.ports, comePrima.ports);
  assert.equal(comePrima.osservazioneTcp, undefined);
  assert.deepEqual(conOsservazione.osservazioneTcp, {
    mac, porte: [
      { protocollo: "tcp", porta: 22, esito: "chiusa" },
      { protocollo: "tcp", porta: 443, esito: "aperta" },
    ],
  });
  assert.equal(parseNmapXml(xmlTcp("up", ""), { osservaTcp: true })[0].osservazioneTcp, undefined);
});

test("la cronologia parte dal secondo giro compatibile, senza duplicati o incroci tra subnet", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE networks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cidr TEXT NOT NULL);
    INSERT INTO networks VALUES (1, 'Subnet 1', '192.0.2.0/24'), (2, 'Subnet 2', '198.51.100.0/24');
  `);
  const prima: StatoGiroRete = {
    id: "prima", tenant: "TEST", reteId: 1, perimetro: "identico", fineMs: adesso - 4000,
    esito: "riuscito", ipVerificati: [ip],
    host: [{ ip, mac, porte: [{ protocollo: "tcp", porta: 22, esito: "chiusa" }] }],
  };
  const dopo: StatoGiroRete = {
    ...prima, id: "dopo", fineMs: adesso - 1000,
    host: [{ ip, mac, porte: [
      { protocollo: "tcp", porta: 22, esito: "aperta" },
      { protocollo: "tcp", porta: 443, esito: "aperta" },
    ] }],
  };
  const leggi = (rete?: number) => leggiCambiRete(db, 1, rete, adesso);
  assert.equal(leggi().confrontato, false);
  registraGiroRete(db, prima);
  registraGiroRete(db, { ...dopo, id: "parziale", fineMs: adesso - 3000, esito: "parziale" });
  registraGiroRete(db, { ...dopo, id: "altro-perimetro", fineMs: adesso - 2000, perimetro: "diverso" });
  registraGiroRete(db, { ...dopo, reteId: 2 });
  assert.deepEqual(leggi().righe, []);
  registraGiroRete(db, dopo);
  registraGiroRete(db, dopo);
  registraGiroRete(db, prima);
  assert.equal(leggi().confrontato, true);
  assert.deepEqual(leggi().righe.map((r) => [r.network_id, r.kind, r.after_value]), [
    [1, "porta_rilevata", "443/tcp"],
    [1, "porta_nuova", "22/tcp"],
  ]);
  assert.equal(leggi(1).righe.length, 2);
  assert.deepEqual(leggi(2).righe, []);
  assert.deepEqual(leggiCambiRete(db, 1, undefined, adesso + 91 * 24 * 3600_000).righe, []);
});
