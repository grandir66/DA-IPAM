/**
 * I rilievi ESET nella pagina dei rilievi (17/11/2026): solo le macchine agganciate a un host,
 * una CVE già vista da un altro motore resta una riga sola, le potenziali dal software stanno
 * nell'elenco ma fuori dai conteggi di testa.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/unione-eset.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getAggregatedVulnerabilities, getTenantDb, withTenant } from "@/lib/db-tenant";
import { assicuraSchemaEset } from "@/lib/integrations/eset-dalink";
import { elencoRilievi } from "../unione";

const T = "PROVAUNIESET";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

function prepara(): { h1: number; h2: number } {
  const d = getTenantDb(T);
  assicuraSchemaEset(d);
  const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'lan')").run().lastInsertRowid);
  const h1 = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.8.0.11', 'online', 'pc-uno')").run(n).lastInsertRowid);
  const h2 = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.8.0.12', 'online', 'pc-due')").run(n).lastInsertRowid);
  const ora = new Date().toISOString();
  const m = d.prepare("INSERT INTO eset_macchina (uuid, nome, mac, ultimo_contatto, letto_il) VALUES (?, ?, '[]', ?, ?)");
  m.run("e1", "pc-uno", ora, ora);
  m.run("e2", "pc-due", ora, ora);
  m.run("e3", "non-agganciata", ora, ora);
  m.run("e4", "ferma-da-mesi", "2026-01-01T00:00:00Z", ora);
  const a = d.prepare("INSERT INTO eset_abbinamento (macchina_uuid, host_id, per, a_mano, quando) VALUES (?, ?, 'nome', 0, ?)");
  a.run("e1", h1, ora);
  a.run("e2", h2, ora);
  a.run("e3", null, ora);
  a.run("e4", h2, ora);
  const v = d.prepare("INSERT INTO eset_vuln (macchina_uuid, cve, fonte, oggetto, versione, gravita, kev, exploit, cvss) VALUES (?,?,?,?,?,?,0,0,?)");
  v.run("e1", "CVE-2026-1001", "eset", "Firefox", "120", "SEVERITY_LEVEL_HIGH", 8.1);
  v.run("e2", "CVE-2026-1001", "eset", "Firefox", "121", "SEVERITY_LEVEL_HIGH", 8.1);
  v.run("e1", "CVE-2026-1002", "software", "Chrome", "120", "SEVERITY_LEVEL_CRITICAL", 9.8);
  v.run("e1", "CVE-2026-1003", "software", "Zip", "1", null, null); // senza gravità: non entra
  v.run("e1", "CVE-2026-1004", "eset", "Vecchio", "1", "SEVERITY_LEVEL_LOW", 2); // bassa: mai nei rilievi
  v.run("e3", "CVE-2026-1005", "eset", "Fuori", "1", "SEVERITY_LEVEL_CRITICAL", 9.9); // non agganciata
  v.run("e4", "CVE-2026-1006", "eset", "Ferma", "1", "SEVERITY_LEVEL_CRITICAL", 9.9); // non vista da mesi
  // la stessa CVE-2026-1001 la vede anche Wazuh su pc-uno
  d.prepare("INSERT INTO wazuh_agent (agent_id, name, ip, host_id, last_keep_alive) VALUES ('001', 'pc-uno', '10.8.0.11', ?, datetime('now'))").run(h1);
  d.prepare("INSERT INTO wazuh_vuln (agent_id, cve, severity, package_name, package_version, status, detection_time) VALUES ('001', 'CVE-2026-1001', 'High', 'firefox', '120', 'VALID', datetime('now'))").run();
  return { h1, h2 };
}

test("ESET nei rilievi: agganciate sì, una riga per CVE, potenziali fuori dai conteggi", () => withTenant(T, () => {
  const { h1, h2 } = prepara();
  const tutti = elencoRilievi({ fonti: ["edge", "wazuh", "eset", "eset_sw"], conIndicatori: true });
  const perTitolo = Object.fromEntries(tutti.data.map((r) => [r.titolo, r]));
  assert.deepEqual(Object.keys(perTitolo).sort(), ["CVE-2026-1001", "CVE-2026-1002"]);
  // la CVE vista da Wazuh ed ESET è una riga sola, su due host
  assert.equal(perTitolo["CVE-2026-1001"]!.host_count, 2);
  assert.deepEqual(tutti.perFonte, { edge: 0, wazuh: 1, eset: 1, eset_sw: 1, trunk: 0, giro: 0 });
  // la potenziale è nell'elenco con la sua fonte, ma la testata non la conta
  assert.equal(perTitolo["CVE-2026-1002"]!.fonte, "eset_sw");
  assert.equal(perTitolo["CVE-2026-1002"]!.gravita, "Critical");
  assert.deepEqual(tutti.rollup, { Critical: 0, High: 1, Medium: 0, Low: 0 });

  const eset = elencoRilievi({ fonti: ["eset", "eset_sw"] });
  assert.deepEqual(eset.data.map((r) => [r.titolo, r.fonte]).sort(), [["CVE-2026-1001", "eset"], ["CVE-2026-1002", "eset_sw"]]);
  assert.match(eset.data.find((r) => r.fonte === "eset")!.prova, /Firefox/);
  const wazuh = elencoRilievi({ fonti: ["wazuh"] });
  assert.deepEqual(wazuh.data.map((r) => [r.titolo, r.fonte, r.host_count]), [["CVE-2026-1001", "wazuh", 1]]);
  // per host: pc-due ha la CVE solo da ESET
  const suDue = elencoRilievi({ ospite: h2 });
  assert.deepEqual(suDue.data.map((r) => r.titolo), ["CVE-2026-1001"]);
  assert.equal(elencoRilievi({ ospite: h1 }).total, 2);
}));

test("fuori dalla pagina dei rilievi le potenziali non si vedono", () => withTenant(T, () => {
  const senza = getAggregatedVulnerabilities({ page: 1, pageSize: 100 });
  assert.ok(senza.data.some((v) => v.cve_id === "CVE-2026-1001" && v.sources.includes("ESET")));
  assert.ok(!senza.data.some((v) => v.cve_id === "CVE-2026-1002"));
  assert.ok(!senza.data.some((v) => v.cve_id === "CVE-2026-1005"), "una macchina non agganciata non dà rilievi");
  const soloEset = getAggregatedVulnerabilities({ page: 1, pageSize: 100, soloMotore: "eset", conPotenzialiEset: true });
  assert.deepEqual(soloEset.data.map((v) => v.cve_id).sort(), ["CVE-2026-1001", "CVE-2026-1002", "CVE-2026-1004", "CVE-2026-1006"]);
  const soloEdge = getAggregatedVulnerabilities({ page: 1, pageSize: 100, soloMotore: "edge" });
  assert.equal(soloEdge.data.length, 0);
}));
