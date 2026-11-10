/**
 * Findings a gruppi: le CVE si raccolgono per cosa aggiornare.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/gruppi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeSoftware, raggruppaPerSoftware } from "../gruppi";
import type { RilievoUnito } from "../tipi";

function r(p: Partial<RilievoUnito> & { id: string }): RilievoUnito {
  return {
    fonte: "wazuh", gravita: "High", titolo: p.id, prova: "", rimedio: "", ip: null, host_id: null,
    network_id: null, network_name: null, visto: null, cve_key: p.id, host_count: 1, chiaveTriage: p.id, ...p,
  };
}

test("nomeSoftware toglie la versione in coda e solo quella", () => {
  assert.equal(nomeSoftware("Google Chrome 120.0.6099.71"), "Google Chrome");
  assert.equal(nomeSoftware("openssl 3.0.2-0ubuntu1.15"), "openssl");
  assert.equal(nomeSoftware("Microsoft Edge"), "Microsoft Edge");
  assert.equal(nomeSoftware("7-Zip 23.01"), "7-Zip");
  assert.equal(nomeSoftware("Mozilla Firefox 67.0.2 (x64 it)"), "Mozilla Firefox");
  assert.equal(nomeSoftware("Microsoft Windows Server 2019 Standard 10.0.17763.8880 10.0.17763.8880"), "Microsoft Windows Server 2019 Standard");
  assert.equal(nomeSoftware("Windows Server 2019"), "Windows Server 2019");
  assert.equal(nomeSoftware("  "), null);
  assert.equal(nomeSoftware(null), null);
});

test("un software = un gruppo, con conteggi, chiavi e stato per CVE", () => {
  const g = raggruppaPerSoftware([
    r({ id: "CVE-1", pacchetto: "Google Chrome 120.0", gravita: "Critical", host_count: 5 }),
    r({ id: "CVE-2", pacchetto: "google chrome 119.9", gravita: "High", host_count: 9, triage: { stato: "in_corso", nota: "", aggiornato_il: "", aggiornato_da: null } }),
    r({ id: "CVE-3", pacchetto: "openssl 3.0.2", gravita: "Medium" }),
  ]);
  const chrome = g.find((x) => x.chiave === "sw:google chrome");
  assert.ok(chrome);
  assert.equal(chrome.rilievi, 2);
  assert.equal(chrome.hostMax, 9);
  assert.deepEqual(chrome.gravita, { Critical: 1, High: 1, Medium: 0, Low: 0 });
  assert.deepEqual(chrome.chiavi.sort(), ["CVE-1", "CVE-2"]);
  assert.equal(chrome.triage.in_corso, 1);
  assert.equal(chrome.triage.da_fare, 1);
  assert.equal(chrome.anteprima[0], "CVE-1");
});

test("ordine: sfruttate attivamente in cima, i contenitori in fondo", () => {
  const g = raggruppaPerSoftware([
    r({ id: "trunk:1", fonte: "trunk", cve_key: null }),
    r({ id: "nvt:9", fonte: "edge", pacchetto: null }),
    r({ id: "CVE-A", pacchetto: "grande 1.0", gravita: "Critical", host_count: 50 }),
    r({ id: "CVE-B", pacchetto: "piccolo 1.0", gravita: "Low", exploit: { kev: true, edb: false } }),
  ]);
  assert.deepEqual(g.map((x) => x.chiave), ["sw:piccolo", "sw:grande", "edge", "senza"]);
  assert.equal(g[0].kev, 1);
});
