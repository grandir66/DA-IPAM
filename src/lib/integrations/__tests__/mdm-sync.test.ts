import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { applyDevice, getMobileDetailByHost } from "@/lib/integrations/mdm-sync";
import type { DeviceView, DeviceInfoView } from "@/lib/integrations/hmdm-client";

const T = "TESTMDMSYNC";
after(() => deleteTenantDatabase(T));

const dv = (over: Partial<DeviceView> = {}): DeviceView => ({
  number: "A1",
  serial: "RZ8",
  imei: "35",
  phone: null,
  androidVersion: "15",
  description: "mario.rossi",
  custom1: null,
  custom2: null,
  custom3: null,
  lastUpdate: 1719400000000,
  enrollTime: 1719000000000,
  info: "{}",
  statusCode: "GREEN",
  ...over,
});

const di = (pkgs: string[], model = "Pixel 8", os = "15"): DeviceInfoView => ({
  model,
  serial: "RZ8",
  imei: "35",
  androidVersion: os,
  batteryLevel: 80,
  cpu: "arm64",
  applications: pkgs.map((p) => ({ applicationName: p, applicationPkg: p, versionInstalled: "1.0" })),
});

test("apply device: insert, dedup, diff, host first-class merge", () => {
  withTenant(T, () => {
    const r1 = applyDevice(dv(), di(["com.whatsapp", "com.android.chrome"]));
    assert.equal(r1.deduped, false);
    assert.ok(r1.hostId, "host created");

    const r2 = applyDevice(dv(), di(["com.whatsapp", "com.android.chrome"]));
    assert.equal(r2.deduped, true);
    assert.equal(r2.hostId, r1.hostId);

    const r3 = applyDevice(dv({ androidVersion: "16" }), di(["com.whatsapp", "com.new"], "Pixel 8", "16"));
    assert.equal(r3.deduped, false);

    const detail = getMobileDetailByHost(r1.hostId!)!;
    assert.equal((detail.inventory as { os_version: string }).os_version, "16");
    assert.equal((detail.inventory as { os_family: string }).os_family, "android");
    assert.equal((detail.inventory as { user_profile: string }).user_profile, "mario.rossi");

    const types = (detail.history as Array<{ change_type: string }>).map((h) => h.change_type);
    assert.ok(types.includes("os_update"), "os_update logged");
    assert.ok(types.includes("app_added"), "app_added logged");
    assert.ok(types.includes("app_removed"), "app_removed logged");

    // app list reflects current state (chrome removed, new added)
    const pkgs = (detail.apps as Array<{ package_name: string }>).map((a) => a.package_name).sort();
    assert.deepEqual(pkgs, ["com.new", "com.whatsapp"]);
  });
});
