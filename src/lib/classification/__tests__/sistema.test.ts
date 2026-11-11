/**
 * Il sistema come attributo a sé e come filtro (11/11/2026).
 * Run: node --import tsx --test src/lib/classification/__tests__/sistema.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passaFiltroSistema, sistemaDi, SISTEMA_IGNOTO } from "../sistema";

describe("sistemaDi", () => {
  it("vale il motore; poi la famiglia dal testo; poi il testo grezzo", () => {
    assert.equal(sistemaDi({ attr_os_family: "windows", os_family: "Apple" }), "windows");
    assert.equal(sistemaDi({ attr_os_family: "", os_family: "Apple" }), "macos");
    assert.equal(sistemaDi({ attr_os_family: "network-os", os_family: "Linux" }), "rete");
    assert.equal(sistemaDi({ os_info: "Microsoft Windows Server 2022" }), "windows");
    assert.equal(sistemaDi({ os_info: "Debian GNU/Linux 13 (trixie)" }), "linux");
    assert.equal(sistemaDi({ os_info: "Mac OS X 14" }), "macos");
    assert.equal(sistemaDi({ os_info: "MikroTik RouterOS 7.22" }), "rete");
  });
  it("senza niente, o con un valore che non conosciamo, non si sa", () => {
    assert.equal(sistemaDi({}), null);
    assert.equal(sistemaDi({ attr_os_family: null, os_family: "Unknown", os_info: "" }), null);
    assert.equal(sistemaDi({ os_info: "KYOCERA Document Solutions Printing System" }), null);
  });
});

describe("passaFiltroSistema", () => {
  it("vuoto prende tutti; un sistema solo i suoi; «ignoto» quelli senza sistema", () => {
    const win = { attr_os_family: "windows" };
    const boh = { os_family: "Unknown" };
    assert.equal(passaFiltroSistema("", win), true);
    assert.equal(passaFiltroSistema("windows", win), true);
    assert.equal(passaFiltroSistema("linux", win), false);
    assert.equal(passaFiltroSistema("windows", boh), false);
    assert.equal(passaFiltroSistema(SISTEMA_IGNOTO, boh), true);
    assert.equal(passaFiltroSistema(SISTEMA_IGNOTO, win), false);
  });
});
