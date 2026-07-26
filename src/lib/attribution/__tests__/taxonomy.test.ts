import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isValidCategory, categoryParent, categoryDepth, commonAncestor,
  mapLegacyClassification,
} from "../taxonomy";

describe("taxonomy", () => {
  it("valida slug a 2 livelli e livello 1", () => {
    assert.equal(isValidCategory("network.access_point"), true);
    assert.equal(isValidCategory("network"), true);
    assert.equal(isValidCategory("unknown"), true);
    assert.equal(isValidCategory("wireless"), false);       // slug legacy sysobj
    assert.equal(isValidCategory("network.wifi"), false);
  });
  it("parent e depth", () => {
    assert.equal(categoryParent("network.access_point"), "network");
    assert.equal(categoryParent("network"), "network");
    assert.equal(categoryDepth("network.access_point"), 2);
    assert.equal(categoryDepth("compute"), 1);
  });
  it("commonAncestor", () => {
    assert.equal(commonAncestor("network.access_point", "network.switch"), "network");
    assert.equal(commonAncestor("network.switch", "compute.server"), null);
    assert.equal(commonAncestor("network", "network.switch"), "network");
  });
  it("mappa i 52 slug legacy", () => {
    assert.deepEqual(mapLegacyClassification("access_point"), { category: "network.access_point", os_family: null });
    assert.deepEqual(mapLegacyClassification("server_windows"), { category: "compute.server", os_family: "windows" });
    assert.deepEqual(mapLegacyClassification("server_linux"), { category: "compute.server", os_family: "linux" });
    assert.deepEqual(mapLegacyClassification("stampante"), { category: "peripheral.printer", os_family: null });
    assert.deepEqual(mapLegacyClassification("multifunzione"), { category: "peripheral.mfp", os_family: null });
    assert.deepEqual(mapLegacyClassification("nas_synology"), { category: "storage.nas", os_family: null });
    assert.deepEqual(mapLegacyClassification("telecamera"), { category: "av.camera", os_family: null });
    assert.deepEqual(mapLegacyClassification("bridge"), { category: "network", os_family: null });
    assert.deepEqual(mapLegacyClassification("web_server"), { category: "compute.server", os_family: null });
    assert.deepEqual(mapLegacyClassification("unknown"), { category: null, os_family: null });
    assert.deepEqual(mapLegacyClassification("slug-inesistente"), { category: null, os_family: null });
  });
  it("ogni slug legacy noto ha una mappatura non-null tranne unknown", async () => {
    const { DEVICE_CLASSIFICATIONS } = await import("@/lib/device-classifications");
    for (const slug of DEVICE_CLASSIFICATIONS) {
      if (slug === "unknown") continue;
      const m = mapLegacyClassification(slug);
      assert.notEqual(m.category, null, `slug legacy senza mappatura: ${slug}`);
    }
  });
});
