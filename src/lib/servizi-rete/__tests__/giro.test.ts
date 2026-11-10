/**
 * Giro dei servizi su un tenant vero in una cartella isolata, con strumenti finti:
 * porte comuni sugli host senza porte, freno su campo e stampa, esiti salvati.
 * Run: node --import tsx --test src/lib/servizi-rete/__tests__/giro.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { avviaGiro, statoGiro } from "../giro";
import type { EsitoSonda } from "../sonde";

const T = "PROVASERVIZI";

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

const esito: EsitoSonda = { metodo: "ssh", banner: "SSH-2.0-OpenSSH_9.6", tls: null, http: null, ssh: { ident: "SSH-2.0-OpenSSH_9.6", kex: ["curve25519-sha256"], hostkey: [], cifrari: [], mac: [], fingerprint: "aa".repeat(32) }, prodotto: "OpenSSH", versione: "9.6" };

async function attendi(): Promise<void> {
  for (let i = 0; i < 200 && statoGiro(T).inCorso; i++) await new Promise((r) => setTimeout(r, 10));
}

test("giro senza porte: trova, salva, rispetta il freno", async () => {
  const sondate: string[] = [];
  withTenant(T, () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'prova')").run().lastInsertRowid);
    const h = d.prepare("INSERT INTO hosts (network_id, ip, status, vendor, last_seen) VALUES (?, ?, 'online', ?, datetime('now'))");
    h.run(n, "10.9.0.10", "Proxmox");
    h.run(n, "10.9.0.20", "Siemens AG"); // di campo: non si tocca
    h.run(n, "10.9.0.30", "Brother"); // stampante: 22 sì, 9100 non è nelle comuni
  });
  const partito = avviaGiro(T, null, {
    porteComuni: "senza-porte",
    strumenti: {
      aperta: async (ip, porta) => porta === 22 || porta === 443,
      sonda: async (ip, porta) => {
        sondate.push(`${ip}:${porta}`);
        return porta === 22 ? esito : null;
      },
    },
  });
  assert.equal(partito, true);
  assert.equal(avviaGiro(T, null), false, "un giro alla volta per tenant");
  await attendi();
  assert.equal(statoGiro(T).errore, null);
  assert.ok(!sondate.some((s) => s.startsWith("10.9.0.20")), "l'apparato di campo non si sonda");
  assert.deepEqual(sondate.filter((s) => s.startsWith("10.9.0.10")).sort(), ["10.9.0.10:22", "10.9.0.10:443"]);
  withTenant(T, () => {
    const d = getTenantDb(T);
    const r = d.prepare("SELECT s.porta, s.metodo, s.prodotto, s.ultima_sonda IS NOT NULL AS sondata FROM servizi_rete s JOIN hosts h ON h.id = s.host_id WHERE h.ip = '10.9.0.10' ORDER BY s.porta").all() as Array<{ porta: number; metodo: string; prodotto: string | null; sondata: number }>;
    assert.deepEqual(r.map((x) => [x.porta, x.metodo, x.prodotto, x.sondata]), [[22, "ssh", "OpenSSH", 1], [443, "aperta", null, 1]]);
    const op = d.prepare("SELECT open_ports FROM hosts WHERE ip = '10.9.0.10'").get() as { open_ports: string };
    assert.deepEqual((JSON.parse(op.open_ports) as Array<{ port: number }>).map((p) => p.port), [22, 443]);
  });
});

test("giro multirete: perimetro, protocollo, impianti e sei tentativi concorrenti", async () => {
  const reti = withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)");
    const host = d.prepare("INSERT INTO hosts (network_id, ip, classification) VALUES (?, ?, ?)");
    const servizio = d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, http_json) VALUES (?, ?, ?, ?)");
    const a = Number(rete.run("10.10.0.0/24", "lan a").lastInsertRowid);
    const b = Number(rete.run("10.11.0.0/24", "lan b").lastInsertRowid);
    const h = host.run(a, "10.10.0.8", "unknown").lastInsertRowid;
    for (const porta of [21, 80, 443, 1433, 3306, 5432, 8080, 8443]) servizio.run(h, porta, "tcp", [80, 443, 8080, 8443].includes(porta) ? "{}" : null);
    servizio.run(h, 161, "tcp", null);
    servizio.run(h, 161, "udp", null);
    servizio.run(host.run(b, "10.11.0.8", "plc").lastInsertRowid, 80, "tcp", "{}");
    return [a, b];
  });
  const sondate: string[] = [];
  const controllate: Array<[string, number]> = [];
  let tentativi = 0;
  assert.equal(avviaGiro(T, reti, {
    proveFabbrica: true,
    strumenti: {
      aperta: async () => false,
      sonda: async (ip) => { sondate.push(ip); return null; },
      controllo: async (ip, porta, opzioni) => {
        controllate.push([ip, porta]);
        await new Promise((resolve) => setImmediate(resolve));
        const usa = opzioni.consumaTentativo();
        if (usa) tentativi += 1;
        return { info: null, tentativiUsati: Number(usa) };
      },
    },
  }), true);
  await attendi();
  assert.equal(statoGiro(T).errore, null);
  assert.deepEqual([...new Set(sondate)], ["10.10.0.8"]);
  assert.deepEqual(controllate.filter(([, porta]) => porta === 161), [["10.10.0.8", 161]]);
  assert.ok(controllate.length > 6);
  assert.equal(tentativi, 6);
  assert.equal(statoGiro(T).fatte, statoGiro(T).totale);
});
