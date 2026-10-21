/**
 * Cosa la finestra «Rendi apparato» deduce da sola e cosa manda alla creazione (tappa 3, 21/10).
 * Prima chiedeva «Tipo dispositivo», «Scan target» e «Sottotipo»: qui si prova che le scelte
 * rimaste bastano a ricavarli, anche per un server con ruoli e per un HPE Comware.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/rendi-apparato.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { corpoCreazione, dataBreve, fonteProposta, portaStandard, profiloEffettivo, quandoBreve, type HostPerRendiApparato, type ScelteComuni } from "@/lib/devices/rendi-apparato";

const base: ScelteComuni = { classificazione: "switch", piattaforma: "hp", variante: null, ruoli: [], protocollo: "ssh", porta: 22 };
const riga = { nome: " sw-core ", ip: "10.0.0.2", credentialId: "7", snmpCredentialId: null };

describe("profiloEffettivo", () => {
  it("HPE switch con variante scelta: vale quella", () => {
    assert.equal(profiloEffettivo({ ...base, variante: "hp_switch_comware" }), "hp_switch_comware");
  });
  it("variante non ammessa (cambiata classificazione): si torna al profilo coerente", () => {
    assert.equal(profiloEffettivo({ ...base, classificazione: "server", variante: "hp_switch_comware" }), "hp_server_ilo");
  });
  it("MikroTik switch: nessuna scelta, profilo dedotto", () => {
    assert.equal(profiloEffettivo({ ...base, piattaforma: "mikrotik" }), "mikrotik_switch");
  });
  it("server Proxmox col ruolo backup: PBS", () => {
    assert.equal(profiloEffettivo({ ...base, classificazione: "server", piattaforma: "proxmox", ruoli: ["backup"] }), "proxmox_pbs");
  });
});

describe("corpoCreazione", () => {
  it("HPE Comware: sottotipo e tipo dispositivo dedotti, nome ripulito", () => {
    const c = corpoCreazione({ ...base, variante: "hp_switch_comware" }, riga);
    assert.equal(c.name, "sw-core");
    assert.equal(c.device_type, "switch");
    assert.equal(c.vendor_subtype, "comware");
    assert.equal(c.product_profile, "hp_switch_comware");
    assert.equal(c.credential_id, 7);
    assert.equal(c.snmp_credential_id, undefined);
    assert.equal(c.use_for_arp_poll, 0);
  });
  it("router: ARP acceso; Proxmox: scan target dal profilo", () => {
    assert.equal(corpoCreazione({ ...base, classificazione: "router", piattaforma: "mikrotik" }, riga).use_for_arp_poll, 1);
    const p = corpoCreazione({ ...base, classificazione: "server", piattaforma: "proxmox", variante: "proxmox_ve", protocollo: "api", porta: 8006 }, riga);
    assert.equal(p.scan_target, "proxmox");
    assert.equal(p.device_type, "server");
  });
  it("ruoli solo per il server", () => {
    assert.deepEqual(corpoCreazione({ ...base, classificazione: "server", piattaforma: "windows", ruoli: ["dc", "dns"] }, riga).server_roles, ["dc", "dns"]);
    assert.equal(corpoCreazione({ ...base, ruoli: ["dc"] }, riga).server_roles, undefined);
  });
  it("senza credenziale: nessun campo credenziale", () => {
    const c = corpoCreazione(base, { ...riga, credentialId: null });
    assert.equal("credential_id" in c, false);
  });
});

describe("porta, fonte e date", () => {
  it("porte standard", () => {
    assert.equal(portaStandard("ssh", 22), true);
    assert.equal(portaStandard("ssh", 2222), false);
    assert.equal(portaStandard("snmp_v3", 161), true);
    assert.equal(portaStandard("winrm", 5985), true);
  });
  it("fonte della proposta", () => {
    const h = { ip: "1.1.1.1", snmp_data: "{}", inferred_confidence: 91.6 } as unknown as HostPerRendiApparato;
    assert.deepEqual(fonteProposta(h), { fonte: "SNMP", confidenza: 92 });
    assert.equal(fonteProposta({ ...h, classification_manual: 1 }).fonte, "scelta a mano");
  });
  it("date in ora italiana: oggi l'ora, prima la data; il database scrive UTC senza fuso", () => {
    const adesso = new Date("2026-10-21T10:00:00Z");
    assert.equal(quandoBreve("2026-10-21 07:41:00", adesso), "09:41");
    assert.equal(quandoBreve("2026-10-20T08:00:00.000Z", adesso), "20/10");
    assert.equal(dataBreve("2026-10-20 22:30:00"), "21/10");
    assert.equal(quandoBreve(null), "");
  });
});
