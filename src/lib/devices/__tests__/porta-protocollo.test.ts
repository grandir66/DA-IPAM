/**
 * La porta dell'apparato segue il protocollo anche nella finestra di modifica (16/10).
 *
 * Incidente (pilota, 16/10): un MikroTik creato in SNMP (porta 161) e poi passato
 * a SSH dalla finestra di modifica è rimasto con protocol=ssh, port=161: la
 * finestra non aveva il campo porta e il PUT non la toccava. L'acquisizione SSH
 * usa `device.port` e falliva (niente tabella MAC né vicini), anche col binding
 * SSH sulla 22 provato con successo.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/porta-protocollo.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portaAlCambioProtocollo, avvisoPortaProtocollo } from "../porta-protocollo";
import type { CredenzialeArchivio } from "../proposta-apparato";

const ARCHIVIO: CredenzialeArchivio[] = [
  { id: 1, name: "SSH standard", credential_type: "ssh", port: null },
  { id: 2, name: "SSH sulla 2022", credential_type: "ssh", port: 2022 },
  { id: 3, name: "Community con porta", credential_type: "snmp", port: 161 },
  { id: 4, name: "SNMP fuori standard", credential_type: "snmp", port: 1161 },
  { id: 5, name: "Windows", credential_type: "windows", port: null },
];

describe("portaAlCambioProtocollo — la porta segue il nuovo protocollo", () => {
  it("il caso del pilota: da SNMP a SSH senza credenziali la porta diventa 22", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [null, null], archivio: ARCHIVIO }), 22);
  });

  it("gli standard degli altri protocolli", () => {
    const p = (protocollo: "snmp_v2" | "snmp_v3" | "winrm" | "api") =>
      portaAlCambioProtocollo({ protocollo, credenziali: [], archivio: ARCHIVIO });
    assert.equal(p("snmp_v2"), 161);
    assert.equal(p("snmp_v3"), 161);
    assert.equal(p("winrm"), 5985);
    assert.equal(p("api"), 443);
  });

  it("la porta propria della credenziale compatibile vince sullo standard", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: ["2", null], archivio: ARCHIVIO }), 2022);
    assert.equal(portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: ["1", "4"], archivio: ARCHIVIO }), 1161);
  });

  it("una credenziale di tipo incompatibile non presta la sua porta (SNMP con porta 161 → SSH resta 22)", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: ["3", null], archivio: ARCHIVIO }), 22);
    assert.equal(portaAlCambioProtocollo({ protocollo: "winrm", credenziali: ["2", "4"], archivio: ARCHIVIO }), 5985);
  });

  it("Proxmox: la porta dell'apparato è quella dell'API e non segue il protocollo", () => {
    assert.equal(
      portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [], archivio: ARCHIVIO, proxmox: true, portaAttuale: 8006 }),
      8006,
    );
    assert.equal(
      portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [], archivio: ARCHIVIO, proxmox: true, portaAttuale: 443 }),
      443,
    );
    assert.equal(portaAlCambioProtocollo({ protocollo: "api", credenziali: [], archivio: ARCHIVIO, proxmox: true }), 8006);
  });
});

describe("avvisoPortaProtocollo — porta standard di un altro protocollo", () => {
  it("il caso del pilota: SSH sulla 161 dà l'avviso, con la porta da usare", () => {
    const a = avvisoPortaProtocollo({ protocol: "ssh", port: 161, vendor: "mikrotik" });
    assert.ok(a, "atteso un avviso");
    assert.match(a, /161/);
    assert.match(a, /SNMP/);
    assert.match(a, /per SSH usa 22/);
  });

  it("WinRM sulla 22 e API sulla 161 danno l'avviso", () => {
    assert.match(avvisoPortaProtocollo({ protocol: "winrm", port: 22, vendor: "windows" }) ?? "", /22 è quella SSH/);
    assert.match(avvisoPortaProtocollo({ protocol: "api", port: 161, vendor: "omada" }) ?? "", /161 è quella SNMP/);
  });

  it("le porte proprie o fuori standard non danno avviso", () => {
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 22, vendor: "mikrotik" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 2222, vendor: "linux" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "winrm", port: 5986, vendor: "windows" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "api", port: 8728, vendor: "mikrotik" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: null, vendor: "mikrotik" }), null);
  });

  it("SNMP non legge device.port (la porta viene dalla credenziale): niente avviso", () => {
    assert.equal(avvisoPortaProtocollo({ protocol: "snmp_v2", port: 22, vendor: "mikrotik" }), null);
  });

  it("Proxmox: device.port è la porta dell'API anche con protocollo SSH", () => {
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 8006, vendor: "proxmox" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 443, vendor: "proxmox" }), null);
  });
});
