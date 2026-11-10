/**
 * Findings a gruppi: gli stessi rilievi letti per software, per host e per rete.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/gruppi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { indicatori, nomeSoftware, raggruppa } from "../gruppi";
import type { OspiteRilievo, RilievoUnito } from "../tipi";

function r(p: Partial<RilievoUnito> & { id: string }): RilievoUnito {
  return {
    fonte: "wazuh", gravita: "High", titolo: p.id, prova: "", rimedio: "", ip: null, host_id: null,
    network_id: null, network_name: null, visto: null, cve_key: p.id, host_count: 1, chiaveTriage: p.id, ...p,
  };
}
const h = (id: number, rete: number): OspiteRilievo => ({ host_id: id, ip: `10.0.${rete}.${id}`, nome: `pc${id}`, network_id: rete, network_name: `lan${rete}` });

test("nomeSoftware toglie le versioni in coda e solo quelle", () => {
  assert.equal(nomeSoftware("Google Chrome 120.0.6099.71"), "Google Chrome");
  assert.equal(nomeSoftware("openssl 3.0.2-0ubuntu1.15"), "openssl");
  assert.equal(nomeSoftware("Microsoft Edge"), "Microsoft Edge");
  assert.equal(nomeSoftware("7-Zip 23.01"), "7-Zip");
  assert.equal(nomeSoftware("Mozilla Firefox 67.0.2 (x64 it)"), "Mozilla Firefox");
  assert.equal(nomeSoftware("Microsoft Windows Server 2019 Standard 10.0.17763.8880 10.0.17763.8880"), "Microsoft Windows Server 2019 Standard");
  assert.equal(nomeSoftware("Windows Server 2019"), "Windows Server 2019");
  assert.equal(nomeSoftware("linux-image-6.8.0-147-generic 6.8.0-147.153"), "Kernel Linux");
  assert.equal(nomeSoftware("linux-image-cloud-amd64"), "Kernel Linux");
  assert.equal(nomeSoftware("  "), null);
  assert.equal(nomeSoftware(null), null);
});

test("per software: un software = un gruppo, host distinti, stato per rilievo", () => {
  const g = raggruppa(
    [
      r({ id: "CVE-1", pacchetto: "Google Chrome 120.0", gravita: "Critical", ospiti: [h(1, 5), h(2, 5)] }),
      r({ id: "CVE-2", pacchetto: "google chrome 119.9", ospiti: [h(2, 5), h(3, 4)], triage: { stato: "in_corso", nota: "", aggiornato_il: "", aggiornato_da: null } }),
      r({ id: "CVE-3", pacchetto: "openssl 3.0.2", gravita: "Medium" }),
    ],
    "software",
  );
  const chrome = g.find((x) => x.chiave === "sw:google chrome");
  assert.ok(chrome);
  assert.equal(chrome.rilievi, 2);
  assert.equal(chrome.host, 3);
  assert.deepEqual(chrome.gravita, { Critical: 1, High: 1, Medium: 0, Low: 0 });
  assert.deepEqual(chrome.chiaviDaFare, ["CVE-1"]);
  assert.equal(chrome.triage.in_corso, 1);
  assert.equal(chrome.anteprima[0], "CVE-1");
});

test("per software: sfruttati attivamente in cima, contenitori in fondo, i nomi di test non sono software", () => {
  const g = raggruppa(
    [
      r({ id: "trunk:1", fonte: "trunk", cve_key: null }),
      r({ id: "nvt:9", fonte: "edge", pacchetto: null }),
      r({ id: "CVE-T", pacchetto: "Apache Tomcat RCE Vulnerability (Mar 2025) - Windows" }),
      r({ id: "CVE-D", pacchetto: "Debian: Security Advisory" }),
      r({ id: "CVE-A", pacchetto: "grande 1.0", gravita: "Critical", host_count: 50 }),
      r({ id: "CVE-B", pacchetto: "piccolo 1.0", gravita: "Low", exploit: { kev: true, edb: false } }),
    ],
    "software",
  );
  assert.deepEqual(g.map((x) => x.chiave), ["sw:piccolo", "sw:grande", "edge", "senza"]);
  assert.equal(g[2].rilievi, 3);
  assert.equal(g[1].host, 50);
});

test("per host e per rete: una CVE entra nel gruppo di ognuno dei suoi host e delle loro reti", () => {
  const righe = [
    r({ id: "CVE-1", gravita: "Critical", ospiti: [h(1, 5), h(2, 4)] }),
    r({ id: "CVE-2", ospiti: [h(1, 5)] }),
    r({ id: "giro:x", fonte: "giro", cve_key: null, host_id: 2, ip: "10.0.4.2", network_id: 4, network_name: "lan4" }),
  ];
  const perHost = raggruppa(righe, "host");
  assert.deepEqual(perHost.map((x) => [x.chiave, x.rilievi]), [["host:1", 2], ["host:2", 2]]);
  assert.equal(perHost[0].nome, "pc1");
  assert.deepEqual(perHost[0].filtro, { ospite: 1 });
  const perRete = raggruppa(righe, "rete");
  const lan5 = perRete.find((x) => x.chiave === "rete:5");
  assert.ok(lan5);
  assert.equal(lan5.rilievi, 2);
  assert.equal(lan5.host, 1);
  assert.deepEqual(lan5.filtro, { rete: 5 });
});

test("indicatori: sfruttate, aggiornamenti che chiudono metà dei critici, host più esposto", () => {
  const i = indicatori([
    r({ id: "CVE-1", pacchetto: "a 1.0", gravita: "Critical", ospiti: [h(1, 5)], exploit: { kev: true, edb: false } }),
    r({ id: "CVE-2", pacchetto: "a 1.0", gravita: "Critical", ospiti: [h(1, 5)] }),
    r({ id: "CVE-3", pacchetto: "a 1.0", gravita: "Critical", ospiti: [h(1, 5)] }),
    r({ id: "CVE-4", pacchetto: "b 1.0", gravita: "Critical", ospiti: [h(2, 5)] }),
  ]);
  assert.equal(i.kev, 1);
  assert.equal(i.kevHost, 1);
  assert.equal(i.criticiConSoftware, 4);
  assert.equal(i.aggiornamentiPerMeta, 1);
  assert.deepEqual(i.hostPiuEsposto, { nome: "pc1", critici: 3, ospite: 1 });
});

test("barrePerRete: una tacca per host toccato, e solo l'host scelto se l'elenco è filtrato su di lui", async () => {
  const { barrePerRete } = await import("../gruppi");
  const righe = [
    r({ id: "CVE-1", gravita: "Critical", ospiti: [h(1, 5), h(2, 5), h(3, 4)] }),
    r({ id: "CVE-2", gravita: "Medium", ospiti: [h(1, 5)] }),
  ];
  assert.deepEqual(barrePerRete(righe).map((b) => [b.network_id, b.critical, b.medium, b.total]), [[5, 2, 1, 3], [4, 1, 0, 1]]);
  assert.deepEqual(barrePerRete(righe, 3).map((b) => [b.network_id, b.total]), [[4, 1]]);
});
