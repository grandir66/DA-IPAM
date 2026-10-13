// Il repo è pubblico: una fixture con un nome, un IP o un MAC vero non passa.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PORTA_GENERICA } from "@/lib/topology/anonimizza";

const DIR = path.join(__dirname, "fixtures");
const FILES = fs.readdirSync(DIR).filter((f) => f.startsWith("topologia-") && f.endsWith(".json"));
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const MAC = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;
const NOME = /^(RTR|SW|AP|FW|HV|NAS|SRV|DEV|host|ext|Sede|Ubicazione|Rete)-\d+$/;

test("ci sono le due fixture", () => {
  assert.deepEqual(FILES.sort(), ["topologia-domarc.json", "topologia-dts.json"]);
});

for (const f of FILES) {
  test(`${f}: solo indirizzi finti e nomi pseudonimi`, () => {
    const testo = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const ip of testo.match(IP) ?? []) assert.ok(ip.startsWith("10.") || ip.startsWith("172.31."), `IP vero? ${ip}`);
    for (const mac of testo.match(MAC) ?? []) assert.ok(mac.toLowerCase().startsWith("02:00:00:"), `MAC vero? ${mac}`);
    for (const parola of ["domarc", "dts", "bergamo"]) assert.equal(testo.toLowerCase().includes(parola), false, parola);
    const j = JSON.parse(testo) as {
      devices: Array<{ name: string }>; hosts: Array<{ hostname: string | null; custom_name: string | null }>; locations: Array<{ name: string }>; networks: Array<{ name: string }>;
      neighbors: Array<{ local_port: string; remote_port: string }>; uplinkPorts: Array<{ port_name: string }>; overrides: Array<{ a_port: string; b_port: string }>;
    };
    // una porta col nome dato dall'amministratore («ether5-Magazzino») dice chi è il cliente
    for (const p of [
      ...j.neighbors.flatMap((n) => [n.local_port, n.remote_port]), ...j.uplinkPorts.map((p) => p.port_name), ...j.overrides.flatMap((o) => [o.a_port, o.b_port]),
    ]) {
      assert.ok(!p || PORTA_GENERICA.test(p.trim()) || /^porta-\d+$/.test(p), `porta vera? ${p}`);
    }
    for (const n of [
      ...j.devices.map((d) => d.name), ...j.locations.map((l) => l.name), ...j.networks.map((n) => n.name),
      ...j.hosts.flatMap((h) => [h.hostname, h.custom_name]).filter((x): x is string => x !== null),
    ]) {
      // un hostname a forma di IP diventa l'IP finto, non un pseudonimo
      assert.ok(NOME.test(n) || /^(10|172\.31)\.\d+\.\d+(\.\d+)?$/.test(n), `nome vero? ${n}`);
    }
  });
}
