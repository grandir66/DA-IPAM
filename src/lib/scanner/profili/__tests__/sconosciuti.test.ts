/**
 * Riconoscimento automatico degli `unknown` (06/11/2026). `-O` manda pacchetti malformati: su un PLC vecchio è la
 * parte che può fare danno (lo dice già il profilo IoT/OT) e il 05/11 al 72729 le stampanti hanno stampato. Quindi la
 * prova che conta è chi resta FUORI dal giro.
 *
 * Run: node --import tsx --test src/lib/scanner/profili/__tests__/sconosciuti.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  CHIAVE_RICONOSCIMENTO, GIORNI_TRA_I_TENTATIVI, HOST_PER_GIRO, PROFILO_RICONOSCIMENTO, giroSconosciuti, scegliSconosciuti,
} from "@/lib/scanner/profili/sconosciuti";
import { argomentiTcp } from "@/lib/scanner/profili/comando";
import type { EsitoProfilo } from "@/lib/scanner/profili/motore";

const T = "SCONOSC06";
let net = 0;

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

beforeEach(() => {
  const d = getTenantDb(T);
  d.exec("DELETE FROM riconoscimento_tentativi; DELETE FROM hosts; DELETE FROM networks; DELETE FROM tenant_settings");
  net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'n')").run().lastInsertRowid);
});

const porte = (...p: number[]) => JSON.stringify(p.map((port) => ({ port, protocol: "tcp", service: null, version: null })));
function host(ip: string, c: { porte?: string; vendor?: string; classification?: string; manual?: number; status?: string } = {}): number {
  return Number(getTenantDb(T).prepare(
    "INSERT INTO hosts (network_id, ip, open_ports, vendor, classification, classification_manual, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(net, ip, c.porte ?? porte(80), c.vendor ?? "Cisco Systems, Inc", c.classification ?? "unknown", c.manual ?? 0, c.status ?? "online").lastInsertRowid);
}
const ips = () => scegliSconosciuti(getTenantDb(T)).map((h) => h.ip);

test("entra un unknown vivo con una porta nota", () => {
  host("10.8.0.1");
  assert.deepEqual(ips(), ["10.8.0.1"]);
});

test("restano fuori: già classificato, a mano, spento, senza porte", () => {
  host("10.8.0.2", { classification: "server" });
  host("10.8.0.3", { manual: 1 });
  host("10.8.0.4", { status: "offline" });
  host("10.8.0.5", { porte: "[]" });
  assert.deepEqual(ips(), []);
});

test("restano fuori le stampanti: 9100 aperta o classe stampante (05/11, 72729)", () => {
  host("10.8.0.6", { porte: porte(80, 9100) });
  assert.deepEqual(ips(), []);
});

test("restano fuori gli apparati di campo: porta OT o produttore OT", () => {
  host("10.8.0.7", { porte: porte(80, 502) });
  host("10.8.0.8", { vendor: "Schneider Electric" });
  host("10.8.0.9", { vendor: "Microchip Technology Inc." });
  host("10.8.0.10", { vendor: "HMS Industrial Networks" });
  assert.deepEqual(ips(), []);
});

test("un tentativo recente tiene fuori, uno vecchio no", () => {
  const a = host("10.8.0.11");
  const b = host("10.8.0.12");
  const d = getTenantDb(T);
  d.prepare("INSERT INTO riconoscimento_tentativi (host_id, ultimo_il, esito) VALUES (?, datetime('now', '-1 days'), 'x')").run(a);
  d.prepare("INSERT INTO riconoscimento_tentativi (host_id, ultimo_il, esito) VALUES (?, datetime('now', ?), 'x')").run(b, `-${GIORNI_TRA_I_TENTATIVI + 1} days`);
  assert.deepEqual(ips(), ["10.8.0.12"]);
});

test("il giro ha un tetto", () => {
  for (let i = 1; i <= HOST_PER_GIRO + 5; i++) host(`10.8.0.${i + 20}`);
  assert.equal(ips().length, HOST_PER_GIRO);
});

test("il profilo non tocca la 9100 né le porte di campo e non fa UDP", () => {
  assert.equal(PROFILO_RICONOSCIMENTO.tcp.includes(9100), false);
  assert.equal(PROFILO_RICONOSCIMENTO.tcp.includes(502), false);
  assert.deepEqual([...PROFILO_RICONOSCIMENTO.udp], []);
  assert.equal(PROFILO_RICONOSCIMENTO.osDetection, true);
  const a = argomentiTcp(PROFILO_RICONOSCIMENTO, { privilegi: true, disponibili: new Set<string>() }).join(" ");
  assert.match(a, / -O /);
  assert.equal(/\b9100\b/.test(a), false);
});

const esitoFinto = (ip: string): EsitoProfilo => ({
  profilo: "riconoscimento",
  host: [{
    ip, rilievi: [], udpSaltata: null, errori: [], fatti: { osInfo: "Cisco SG200 or SG300 switch" },
    risultato: { ip, alive: true, ports: [], os: "Cisco SG200 or SG300 switch", mac: null },
  }],
  scriptMancanti: [], osDetectionSaltata: false, registro: [],
});

test("spento di serie: nessun nmap", async () => {
  await withTenant(T, async () => {
    host("10.8.0.40");
    let chiamate = 0;
    const e = await giroSconosciuti(T, async () => { chiamate++; return esitoFinto("10.8.0.40"); });
    assert.equal(chiamate, 0);
    assert.equal(e.provati, 0);
  });
});

test("acceso: prova, salva l'esito e non ripete il giorno dopo", async () => {
  await withTenant(T, async () => {
    const id = host("10.8.0.41");
    setTenantSetting(CHIAVE_RICONOSCIMENTO, "1");
    const e = await giroSconosciuti(T, async (_p, lista) => esitoFinto(lista[0]));
    assert.equal(e.provati, 1);
    const r = getTenantDb(T).prepare("SELECT os_info, attr_category, classification FROM hosts WHERE id = ?").get(id) as Record<string, string | null>;
    assert.equal(r.os_info, "Cisco SG200 or SG300 switch");
    assert.equal(r.attr_category, "network.switch");
    assert.equal(r.classification, "switch");
    assert.deepEqual(ips(), []);
  });
});
