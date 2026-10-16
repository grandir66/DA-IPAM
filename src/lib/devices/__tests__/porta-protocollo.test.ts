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
import { portaAlCambioProtocollo, portaDaBinding, avvisoPortaProtocollo, type BindingPorta } from "../porta-protocollo";
import type { CredenzialeArchivio } from "../proposta-apparato";

const ARCHIVIO: CredenzialeArchivio[] = [
  { id: 1, name: "SSH standard", credential_type: "ssh", port: null },
  { id: 2, name: "SSH sulla 2022", credential_type: "ssh", port: 2022 },
  { id: 3, name: "Community con porta", credential_type: "snmp", port: 161 },
  { id: 4, name: "SNMP fuori standard", credential_type: "snmp", port: 1161 },
  { id: 5, name: "Windows", credential_type: "windows", port: null },
];

const SSH_2222: BindingPorta = { protocol_type: "ssh", port: 2222, credential_id: 1, credential_type: "ssh", test_status: "untested" };
const SSH_RIUSCITO_2122: BindingPorta = { protocol_type: "ssh", port: 2122, credential_id: 2, credential_type: "ssh", test_status: "success" };
const SSH_FALLITO_2023: BindingPorta = { protocol_type: "ssh", port: 2023, credential_id: 1, credential_type: "ssh", test_status: "failed" };
const INLINE_2200: BindingPorta = { protocol_type: "ssh", port: 2200, credential_id: null, credential_type: null, test_status: "untested" };
const SNMP_161: BindingPorta = { protocol_type: "snmp", port: 161, credential_id: 3, credential_type: "snmp", test_status: "success" };

describe("portaAlCambioProtocollo — la porta segue il nuovo protocollo", () => {
  it("il caso del pilota: da SNMP a SSH senza credenziali la porta diventa 22", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [null, null], archivio: ARCHIVIO }), 22);
  });

  it("gli standard degli altri protocolli", () => {
    const p = (protocollo: "winrm" | "api") => portaAlCambioProtocollo({ protocollo, credenziali: [], archivio: ARCHIVIO });
    assert.equal(p("winrm"), 5985);
    assert.equal(p("api"), 443);
  });

  it("la porta propria della credenziale compatibile vince sullo standard", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: ["2", null], archivio: ARCHIVIO }), 2022);
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

describe("portaAlCambioProtocollo — verso SNMP la porta resta quella del ripiego SSH", () => {
  // Per un apparato SNMP device.port è la porta del ripiego SSH della tabella MAC
  // (switch-client: createSshWithFallbackCommands → device.port || 22). SNMP prende
  // la sua dalla credenziale (T8): portarla a 161 rompeva il ripiego.
  it("da ssh/22 a snmp_v2 la porta resta 22, mai 161", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: ["1", null], archivio: ARCHIVIO, portaAttuale: 22 }), 22);
    assert.equal(portaAlCambioProtocollo({ protocollo: "snmp_v3", credenziali: [null, null], archivio: ARCHIVIO, portaAttuale: 22 }), 22);
  });

  it("una porta SSH fuori standard resta, anche con una credenziale SNMP che ha la sua porta", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: ["1", "4"], archivio: ARCHIVIO, portaAttuale: 2222 }), 2222);
  });

  it("porta vuota: la porta SSH dell'apparato (binding, poi 22), non la 161", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: [null, "3"], archivio: ARCHIVIO }), 22);
    assert.equal(
      portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: [null, null], archivio: ARCHIVIO, binding: [SSH_2222] }),
      2222,
    );
  });
});

describe("portaAlCambioProtocollo — la porta SSH dai binding dell'apparato", () => {
  // Nella finestra di modifica le credenziali stanno nei binding (DeviceCredentialsTable),
  // ognuno con la sua porta; credential_id può puntare alla voce SNMP o essere NULL.
  it("MikroTik creato in SNMP con un binding SSH sulla 2222: passando a SSH la porta è 2222", () => {
    assert.equal(
      portaAlCambioProtocollo({ protocollo: "ssh", credenziali: ["3", "3"], archivio: ARCHIVIO, binding: [SNMP_161, SSH_2222], portaAttuale: 161 }),
      2222,
    );
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [null, null], archivio: ARCHIVIO, binding: [SSH_2222] }), 2222);
  });

  it("il binding vince sulla porta propria della voce nelle colonne", () => {
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: ["2", null], archivio: ARCHIVIO, binding: [SSH_2222] }), 2222);
  });

  it("l'ordine del motore: d'archivio riusciti, d'archivio non provati, inline; i falliti saltati", () => {
    assert.equal(portaDaBinding([INLINE_2200, SSH_2222, SSH_RIUSCITO_2122], "ssh"), 2122);
    assert.equal(portaDaBinding([INLINE_2200, SSH_2222], "ssh"), 2222);
    assert.equal(portaDaBinding([SSH_FALLITO_2023, INLINE_2200], "ssh"), 2200);
    assert.equal(portaDaBinding([SSH_FALLITO_2023], "ssh"), null);
  });

  it("un binding SSH con una voce di tipo incompatibile, o di un altro protocollo, non presta la porta", () => {
    const sshConVoceSnmp = { ...SSH_2222, credential_id: 3, credential_type: "snmp" };
    assert.equal(portaDaBinding([sshConVoceSnmp, SNMP_161], "ssh"), null);
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [], archivio: ARCHIVIO, binding: [sshConVoceSnmp] }), 22);
  });
});

describe("portaAlCambioProtocollo — tornando al protocollo salvato torna la porta salvata", () => {
  it("ssh/2222 passato a snmp_v2 e riportato a ssh prima di salvare: 2222, non 22", () => {
    const salvata = { protocollo: "ssh", porta: 2222 };
    const versoSnmp = portaAlCambioProtocollo({ protocollo: "snmp_v2", credenziali: [], archivio: ARCHIVIO, portaAttuale: 2222, salvata });
    assert.equal(versoSnmp, 2222);
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [], archivio: ARCHIVIO, portaAttuale: versoSnmp, salvata }), 2222);
  });

  it("anche dopo un passaggio che ha cambiato la porta (ssh/2222 → winrm 5985 → ssh)", () => {
    const salvata = { protocollo: "ssh", porta: 2222 };
    assert.equal(portaAlCambioProtocollo({ protocollo: "ssh", credenziali: [], archivio: ARCHIVIO, portaAttuale: 5985, salvata }), 2222);
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

  it("SNMP sulla 22: device.port è la porta del ripiego SSH (la porta SNMP viene dalla credenziale), niente avviso", () => {
    assert.equal(avvisoPortaProtocollo({ protocol: "snmp_v2", port: 22, vendor: "mikrotik" }), null);
  });

  it("Proxmox: device.port è la porta dell'API anche con protocollo SSH", () => {
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 8006, vendor: "proxmox" }), null);
    assert.equal(avvisoPortaProtocollo({ protocol: "ssh", port: 443, vendor: "proxmox" }), null);
  });
});
