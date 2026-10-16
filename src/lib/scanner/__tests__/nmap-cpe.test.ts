/**
 * Test-invariante: il parser nmap NON deve perdere i CPE.
 *
 * L'incidente, misurato il 2026-09-07 sul database di un tenant reale: 664
 * porte, 194 con il dato di versione ("OpenSSH 9.6p1", "nginx 1.24.0",
 * "Apache Tomcat"...) e **zero** con un CPE. Non perche' nmap non li emettesse,
 * ma perche' `parseNmapXml` leggeva solo gli attributi `product` e `version` di
 * `<service>` e ignorava i figli `<cpe>`. Senza CPE il match con l'NVD non si
 * puo' fare: la stringa libera "OpenSSH 9.6p1 Ubuntu 3ubuntu13.15" non si
 * confronta con i cpeMatch, `cpe:/a:openbsd:openssh:9.6p1` si'.
 *
 * Questi test esistono perche' quella perdita era silenziosa: nessuno falliva,
 * il campo semplicemente non c'era. Se qualcuno riscrive il parser, qui si rompe.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/nmap-cpe.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNmapXml } from "../nmap";
import { getNmapVersionIntensity, buildTcpScanArgs } from "../ports";

/** Risposta nmap realistica: due CPE su una porta, uno sull'altra, nessuno sulla terza. */
const XML_DUE_CPE = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="192.168.40.10" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open"/>
        <service name="ssh" product="OpenSSH" version="9.6p1 Ubuntu 3ubuntu13.15" method="probed">
          <cpe>cpe:/a:openbsd:openssh:9.6p1</cpe>
          <cpe>cpe:/o:linux:linux_kernel</cpe>
        </service>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open"/>
        <service name="http" product="nginx" version="1.24.0" method="probed">
          <cpe>cpe:/a:igor_sysoev:nginx:1.24.0</cpe>
        </service>
      </port>
      <port protocol="tcp" portid="8291">
        <state state="open"/>
        <service name="winbox" product="MikroTik WinBox" method="table"/>
      </port>
    </ports>
  </host>
</nmaprun>`;

describe("parseNmapXml — i CPE arrivano fino in fondo", () => {
  const [host] = parseNmapXml(XML_DUE_CPE);
  const porta = (n: number) => host.ports.find((p) => p.port === n)!;

  it("legge tutti i CPE di una porta, non solo il primo", () => {
    assert.deepEqual(porta(22).cpes, [
      "cpe:/a:openbsd:openssh:9.6p1",
      "cpe:/o:linux:linux_kernel",
    ]);
  });

  it("legge il CPE anche quando ce n'e' uno solo (nodo non-array)", () => {
    assert.deepEqual(porta(80).cpes, ["cpe:/a:igor_sysoev:nginx:1.24.0"]);
  });

  it("una porta senza CPE da' array vuoto, non undefined: chi legge non deve difendersi", () => {
    assert.deepEqual(porta(8291).cpes, []);
  });

  it("tiene prodotto e versione separati — dalla stringa unita non si torna indietro", () => {
    assert.equal(porta(22).product, "OpenSSH");
    assert.equal(porta(22).product_version, "9.6p1 Ubuntu 3ubuntu13.15");
  });

  it("la stringa unita resta identica a prima: UI, classificatore e fingerprint la leggono", () => {
    assert.equal(porta(22).version, "OpenSSH 9.6p1 Ubuntu 3ubuntu13.15");
    assert.equal(porta(80).version, "nginx 1.24.0");
    /* Prodotto senza versione: nessuno spazio in coda. */
    assert.equal(porta(8291).version, "MikroTik WinBox");
  });

  it("un servizio non riconosciuto lascia i campi a null, non a stringa vuota", () => {
    const [h] = parseNmapXml(`<?xml version="1.0"?>
      <nmaprun><host><status state="up"/>
        <address addr="10.0.0.1" addrtype="ipv4"/>
        <ports><port protocol="tcp" portid="9999"><state state="open"/>
          <service name="unknown" method="table"/>
        </port></ports>
      </host></nmaprun>`);
    assert.equal(h.ports[0].version, null);
    assert.equal(h.ports[0].product, null);
    assert.deepEqual(h.ports[0].cpes, []);
  });
});

describe("intensita' -sV — la manopola esiste ma nasce ferma", () => {
  it("di default e' 0: il comportamento in produzione non cambia al deploy", () => {
    delete process.env.DA_INVENT_NMAP_VERSION_INTENSITY;
    assert.equal(getNmapVersionIntensity(), 0);
    assert.match(buildTcpScanArgs(), /--version-intensity 0\b/);
  });

  it("si alza da variabile d'ambiente, e finisce davvero negli argomenti nmap", () => {
    process.env.DA_INVENT_NMAP_VERSION_INTENSITY = "5";
    try {
      assert.equal(getNmapVersionIntensity(), 5);
      assert.match(buildTcpScanArgs(), /--version-intensity 5\b/);
    } finally {
      delete process.env.DA_INVENT_NMAP_VERSION_INTENSITY;
    }
  });

  it("valori fuori scala o non numerici non producono un comando nmap invalido", () => {
    for (const [dato, atteso] of [["99", 9], ["-3", 0], ["pippo", 0], ["", 0]] as const) {
      process.env.DA_INVENT_NMAP_VERSION_INTENSITY = dato;
      assert.equal(getNmapVersionIntensity(), atteso, `input ${JSON.stringify(dato)}`);
    }
    delete process.env.DA_INVENT_NMAP_VERSION_INTENSITY;
  });
});
