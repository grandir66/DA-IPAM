/**
 * Fisico o virtuale come attributo a sé (11/11/2026).
 * Run: node --import tsx --test src/lib/classification/__tests__/forma.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formaDi, passaFiltroForma, FORMA_IGNOTA } from "../forma";

describe("formaDi", () => {
  it("i prefissi degli hypervisor: VMware, QEMU, Proxmox, Hyper-V", () => {
    for (const mac of ["00:50:56:AA:BB:CC", "52:54:00:12:34:56", "BC:24:11:02:65:2A", "00-15-5d-01-02-03"]) {
      assert.equal(formaDi({ mac }), "virtuale", mac);
    }
  });
  it("il produttore o il modello dicono virtuale anche senza il prefisso", () => {
    assert.equal(formaDi({ mac: "02:88:49:01:94:28", vendor: "VMware, Inc." }), "virtuale");
    assert.equal(formaDi({ model: "VMware Virtual Platform" }), "virtuale");
    assert.equal(formaDi({ model: "Standard PC (Q35 + ICH9, 2009)" }), "virtuale");
    assert.equal(formaDi({ attr_category: "compute.vm" }), "virtuale");
  });
  it("un host Proxmox fisico non è virtuale: conta la scheda, non il nome del prodotto (misura del 70791)", () => {
    assert.equal(formaDi({ mac: "58:47:CA:7F:8E:06", vendor: "Shenzhen Meigao Electronic Equipment Co.,Ltd", classification: "hypervisor", attr_category: "compute.hypervisor", model: "Proxmox VE KVM host" }), "fisico");
    assert.equal(formaDi({ mac: "BC:24:11:00:00:01", vendor: "Proxmox Server Solutions GmbH", classification: "hypervisor" }), "virtuale");
  });
  it("«Microsoft» da solo non è Hyper-V: un Surface è fisico", () => {
    assert.equal(formaDi({ mac: "C8:3F:26:11:22:33", vendor: "Microsoft Corporation" }), "fisico");
  });
  it("una scheda di un produttore vero è fisica", () => {
    assert.equal(formaDi({ mac: "58:47:CA:7F:8E:07", vendor: "Shenzhen Meigao Electronic Equipment Co.,Ltd" }), "fisico");
    assert.equal(formaDi({ mac: "90:09:D0:68:E3:BD", vendor: "Synology Incorporated" }), "fisico");
  });
  it("MAC casuale, MAC assente o produttore assente: non si sa", () => {
    assert.equal(formaDi({ mac: "4A:08:63:EA:11:AF" }), null);
    assert.equal(formaDi({ mac: "4A:08:63:EA:11:AF", vendor: "HP Inc." }), null);
    assert.equal(formaDi({}), null);
    assert.equal(formaDi({ mac: "58:47:CA:7F:8E:07", vendor: "" }), null);
  });
});

describe("passaFiltroForma", () => {
  it("vuoto tutti; una forma solo la sua; «ignoto» quelli di cui non si sa", () => {
    const vm = { mac: "BC:24:11:02:65:2A" };
    const boh = { mac: "4A:08:63:EA:11:AF" };
    assert.equal(passaFiltroForma("", vm), true);
    assert.equal(passaFiltroForma("virtuale", vm), true);
    assert.equal(passaFiltroForma("fisico", vm), false);
    assert.equal(passaFiltroForma(FORMA_IGNOTA, boh), true);
    assert.equal(passaFiltroForma(FORMA_IGNOTA, vm), false);
  });
});
