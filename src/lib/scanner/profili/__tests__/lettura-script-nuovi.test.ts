/**
 * I tre script che prima buttavamo (Riccardo, 05/11/2026: «tutti e tre»):
 * `snmp-info`, `vmware-version`, `ldap-rootdse`. Le fixture sono gli elems e
 * l'output **veri** letti dai rilievi del 72729 il 05/11, entita' XML comprese:
 * nell'archivio una riga nuova e' `&#xa;`, non "\n".
 *
 * Run: node --import tsx --test src/lib/scanner/profili/__tests__/lettura-script-nuovi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fattiDaScript, pesoScript } from "../lettura";
import type { NmapScriptOutput } from "@/types";

const script = (id: string, elems: Record<string, string> = {}, output: string | null = null): NmapScriptOutput =>
  ({ id, elems, output }) as NmapScriptOutput;

describe("snmp-info", () => {
  it("l'iLO di HPE: produttore dall'enterprise e seriale dall'engine ID in chiaro", () => {
    const f = fattiDaScript(
      script("snmp-info", {
        enterprise: "Compaq",
        engineIDFormat: "text",
        engineIDData: "CZJ2291NHC",
        snmpEngineBoots: "18",
        snmpEngineTime: "20761d15h52m37s",
      })
    );
    assert.equal(f.produttore, "Compaq");
    assert.equal(f.seriale, "CZJ2291NHC");
  });

  it("engine ID esadecimale: NON e' un seriale e non si scrive", () => {
    const f = fattiDaScript(
      script("snmp-info", {
        enterprise: "SNMP Research",
        engineIDFormat: "unknown",
        engineIDData: "000000a1c0a80014",
      })
    );
    assert.equal(f.produttore, "SNMP Research");
    assert.equal(f.seriale, undefined, "un engine ID in esadecimale finirebbe nella chiave degli apparati");
  });

  it("formato «text» ma valore troppo corto: niente seriale", () => {
    const f = fattiDaScript(script("snmp-info", { engineIDFormat: "text", engineIDData: "ab" }));
    assert.equal(f.seriale, undefined);
  });
});

describe("vmware-version", () => {
  it("ESXi: sistema operativo con la versione e il build, produttore VMware", () => {
    const f = fattiDaScript(
      script("vmware-version", {
        "Server version": "VMware ESXi 7.0.3",
        Build: "20036589",
        "Locale version": "INTL 000",
        "OS type": "vmnix-x86",
        "Product Line ID": "embeddedEsx",
      })
    );
    assert.equal(f.osInfo, "VMware ESXi 7.0.3 build 20036589");
    assert.equal(f.produttore, "VMware");
    assert.equal(f.modello, undefined, "«embeddedEsx» non e' un modello");
  });

  it("senza build resta la versione nuda", () => {
    const f = fattiDaScript(script("vmware-version", { "Server version": "VMware ESXi 8.0.3" }));
    assert.equal(f.osInfo, "VMware ESXi 8.0.3");
  });
});

describe("ldap-rootdse", () => {
  /* Output vero di un domain controller del 72729, con le entita' come sono in archivio. */
  const USCITA_DC =
    "&#xa;LDAP Results&#xa;  &lt;ROOT&gt;&#xa;      domainFunctionality: 7&#xa;" +
    "      forestFunctionality: 7&#xa;      domainControllerFunctionality: 7&#xa;" +
    "      rootDomainNamingContext: DC=sanfrancesco,DC=local&#xa;" +
    "      ldapServiceName: sanfrancesco.local:server01$@SANFRANCESCO.LOCAL&#xa;" +
    "      isGlobalCatalogReady: TRUE&#xa;";

  it("dominio dal DN e nome host dal ldapServiceName, con l'output entita' comprese", () => {
    const f = fattiDaScript(script("ldap-rootdse", {}, USCITA_DC));
    assert.equal(f.dominio, "sanfrancesco.local");
    assert.equal(f.hostname, "server01.sanfrancesco.local");
  });

  it("il vCenter dichiara il suo dominio interno", () => {
    const f = fattiDaScript(
      script(
        "ldap-rootdse",
        {},
        "&#xa;LDAP Results&#xa;  dn: cn=DSE Root&#xa;      rootDomainNamingContext: dc=vsphere,dc=local&#xa;" +
          "      defaultNamingContext: dc=vsphere,dc=local&#xa;"
      )
    );
    assert.equal(f.dominio, "vsphere.local");
    assert.equal(f.hostname, undefined, "senza ldapServiceName non si inventa un nome");
  });

  it("un DN che non e' fatto di DC= non diventa un dominio", () => {
    const f = fattiDaScript(script("ldap-rootdse", {}, "rootDomainNamingContext: cn=schemacontext"));
    assert.equal(f.dominio, undefined);
  });
});

describe("entita' XML nell'output", () => {
  it("snmp-sysdescr prende la prima riga vera, non tutto l'output", () => {
    const f = fattiDaScript(
      script("snmp-sysdescr", {}, "&#xa;  Hardware: Intel64 Family 6&#xa;  Software: Windows Version 10.0&#xa;")
    );
    assert.equal(f.osInfo, "Hardware: Intel64 Family 6");
  });

  it("upnp-info legge il modello anche con le entita'", () => {
    const f = fattiDaScript(
      script("upnp-info", {}, "&#xa;  Manufacturer: QNAP&#xa;  Model Name: TS-231K&#xa;")
    );
    assert.equal(f.modello, "TS-231K");
    assert.equal(f.produttore, "QNAP");
  });
});

describe("ordine di affidabilita'", () => {
  it("ssl-cert dice il produttore prima di snmp-info (nome di oggi, non «Compaq»)", () => {
    assert.ok(pesoScript("ssl-cert") < pesoScript("snmp-info"));
  });

  it("per un ESXi vale vmware-version prima di snmp-sysdescr e del certificato", () => {
    assert.ok(pesoScript("vmware-version") < pesoScript("snmp-sysdescr"));
    assert.ok(pesoScript("vmware-version") < pesoScript("ssl-cert"));
  });

  it("il nome host lo dicono prima RDP e SMB, poi il rootDSE", () => {
    assert.ok(pesoScript("rdp-ntlm-info") < pesoScript("ldap-rootdse"));
    assert.ok(pesoScript("smb-os-discovery") < pesoScript("ldap-rootdse"));
  });
});
