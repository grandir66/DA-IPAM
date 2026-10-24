/**
 * Sensore trunk (2026-10-24): lettura dal socket Unix, freno del tenant, cursore,
 * copia nella tabella MAC↔IP.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/sensore-trunk.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  getTrunkOsservazioniPaginated,
  getTrunkVlan,
  leggiDalSocket,
  SensoreTrunkAssente,
  sincronizzaTrunk,
} from "@/lib/trunk/sensore-trunk";

const T = "TRUNK2410";
const dir = mkdtempSync(join(tmpdir(), "trunk-"));
const sock = join(dir, "api.sock");
const richieste: string[] = [];

const oss = [
  { id: 1, vid: 10, mac: "aa:bb:cc:00:00:01", ip: "192.168.10.1", nome: "gw", fonte_nome: "dhcp", passivo: true, attivo: false, prima_vista: "2026-10-24T10:00:00", ultima_vista: "2026-10-24T10:00:00" },
  { id: 2, vid: 10, mac: "aa:bb:cc:00:00:02", ip: "192.168.10.20", nome: null, fonte_nome: null, passivo: false, attivo: true, prima_vista: "2026-10-24T10:00:01", ultima_vista: "2026-10-24T10:00:01" },
  { id: 3, vid: 20, mac: "zz", ip: "", nome: null, fonte_nome: null, passivo: true, attivo: false, prima_vista: "2026-10-24T10:00:02", ultima_vista: "2026-10-24T10:00:02" },
];

const server: Server = createServer((req, res) => {
  richieste.push(req.url ?? "");
  const u = new URL(req.url ?? "/", "http://x");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/stato") return res.end(JSON.stringify({ tag_letti: true }));
  if (u.pathname === "/vlan") {
    return res.end(JSON.stringify({ vlan: [
      { vid: 10, vista: true, dichiarata: false, mac: 2, ultima_vista: "2026-10-24T10:00:01", reti: [{ vid: 10, cidr: "192.168.10.0/24", gateway_ip: "192.168.10.1" }] },
      { vid: 30, vista: false, dichiarata: true, mac: 0, ultima_vista: null, reti: [] },
    ] }));
  }
  if (u.pathname === "/osservazioni") {
    const dopoId = Number(u.searchParams.get("dopo_id") ?? 0);
    const limite = Number(u.searchParams.get("limite"));
    const righe = oss.filter((o) => !u.searchParams.get("dopo") || o.id > dopoId).slice(0, limite);
    return res.end(JSON.stringify({ osservazioni: righe, prossimo: null }));
  }
  res.statusCode = 404;
  res.end("{}");
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("socket assente: SensoreTrunkAssente, non un errore generico", async () => {
  await assert.rejects(leggiDalSocket("/stato", undefined, join(dir, "manca.sock")), SensoreTrunkAssente);
});

test("spento di serie: nessuna lettura", async () => {
  await withTenant(T, async () => {
    const r = await sincronizzaTrunk({ fonte: "socket", leggi: () => { throw new Error("non doveva leggere"); } });
    assert.equal(r.nota, "lettura spenta");
  });
});

test("acceso: VLAN, osservazioni, cursore e MAC↔IP", async () => {
  await new Promise<void>((ok) => server.listen(sock, ok));
  process.env.SENSORE_TRUNK_SOCKET = sock;
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('192.168.10.0/24', 'v10')").run();
    setTenantSetting("trunk_lettura", "1");
    const r = await sincronizzaTrunk();
    assert.equal(r.fonte, "socket");
    assert.equal(r.vlan, 2);
    assert.equal(r.osservazioni, 2, "il MAC non valido si scarta");
    const vlan = getTrunkVlan();
    assert.deepEqual(vlan.map((v) => [v.vid, v.vista, v.dichiarata]), [[10, 1, 0], [30, 0, 1]]);
    assert.equal(vlan[0].reti[0].gateway_ip, "192.168.10.1");
    assert.deepEqual(JSON.parse(getTenantSetting("trunk_cursore") ?? "{}"), { dopo: "2026-10-24T10:00:02", dopo_id: 3 });
    const m = d.prepare("SELECT ip, source, hostname, network_id FROM mac_ip_mapping ORDER BY ip").all() as Array<{ ip: string; source: string; hostname: string | null; network_id: number | null }>;
    assert.equal(m.length, 2);
    assert.equal(m[0].source, "arp");
    assert.equal(m[0].hostname, "gw");
    assert.ok(m[0].network_id);

    // secondo giro: parte dal cursore, niente doppioni
    richieste.length = 0;
    const r2 = await sincronizzaTrunk();
    assert.equal(r2.osservazioni, 0);
    assert.ok(richieste.some((u) => u.includes("dopo_id=3")));
    assert.equal(getTrunkOsservazioniPaginated({}).totale, 2);
    assert.equal(getTrunkOsservazioniPaginated({ vid: 10, q: "gw" }).totale, 1);
  });
});
