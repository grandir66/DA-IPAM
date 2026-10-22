/**
 * Varianti di un profilo prodotto (tappa 3, finestra «Rendi apparato», 21/10).
 *
 * La finestra chiedeva «Tipo dispositivo», «Scan target» e «Sottotipo» oltre a
 * classificazione e piattaforma: tre domande a cui il sistema sa rispondere da
 * solo. Resta una sola domanda, «Variante», e solo quando classificazione e
 * piattaforma lasciano più di un modello possibile (HPE switch: ProCurve,
 * Comware, ArubaOS; Proxmox server: VE o PBS). Per un MikroTik switch il campo
 * non esiste.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/varianti.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { variantiPer, resolveDeviceTypeForCreate, PRODUCT_PROFILE_IDS, PRODUCT_PROFILES_BY_VENDOR } from "@/lib/device-product-profiles";

describe("variantiPer", () => {
  it("MikroTik switch: una sola variante, il campo si nasconde", () => {
    assert.deepEqual(variantiPer("mikrotik", "switch"), ["mikrotik_switch"]);
  });

  it("HPE switch: tre varianti", () => {
    assert.deepEqual(variantiPer("hp", "switch"), ["hp_switch_procurve", "hp_switch_comware", "hp_switch_arubaos"]);
  });

  it("Proxmox server: VE o PBS", () => {
    assert.deepEqual(variantiPer("proxmox", "server"), ["proxmox_ve", "proxmox_pbs"]);
  });

  it("Windows server e Windows PC: una sola, dedotta dalla classificazione", () => {
    assert.deepEqual(variantiPer("windows", "server"), ["windows_server"]);
    assert.deepEqual(variantiPer("windows", "workstation"), ["windows_client"]);
  });

  it("HPE stampante e HPE server non si mescolano con gli switch", () => {
    assert.deepEqual(variantiPer("hp", "stampante"), ["hp_stampante"]);
    assert.deepEqual(variantiPer("hp", "server"), ["hp_server_ilo"]);
  });

  it("vecchi slug di classificazione: il canonico decide", () => {
    assert.deepEqual(variantiPer("proxmox", "backup_server"), ["proxmox_ve", "proxmox_pbs"]);
  });

  it("classificazione vuota o sconosciuta: nessuna variante da chiedere", () => {
    assert.deepEqual(variantiPer("hp", ""), []);
    assert.deepEqual(variantiPer("hp", "inesistente"), []);
  });

  it("ogni variante restituita appartiene alla piattaforma", () => {
    for (const [vendor, profili] of Object.entries(PRODUCT_PROFILES_BY_VENDOR)) {
      for (const cl of ["switch", "router", "server", "access_point", "nas", "notebook", "workstation", "stampante", "hypervisor"]) {
        for (const p of variantiPer(vendor, cl)) {
          assert.ok(profili.includes(p), `${p} non è di ${vendor}`);
          assert.ok((PRODUCT_PROFILE_IDS as readonly string[]).includes(p));
        }
      }
    }
  });
});

describe("device_type dalla variante (revisione finale, n. 6)", () => {
  it("Server + Proxmox VE o PBS → hypervisor, non server", () => {
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "proxmox_ve", classification: "server" }), "hypervisor");
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "proxmox_pbs", classification: "server" }), "hypervisor");
  });
  it("Server + vSphere → hypervisor; Server + Windows/Linux/iLO restano server", () => {
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "vmware_vsphere", classification: "server" }), "hypervisor");
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "windows_server", classification: "server" }), "server");
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "hp_server_ilo", classification: "server" }), "server");
  });
  it("HPE switch → switch", () => {
    assert.equal(resolveDeviceTypeForCreate({ product_profile: "hp_switch_comware", classification: "switch" }), "switch");
  });
});
