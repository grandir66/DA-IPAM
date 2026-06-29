import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeviceSearchResponse, parseDeviceInfoResponse, parseInfoBlob } from "@/lib/integrations/hmdm-client";

test("parse device search payload (data.devices.items)", () => {
  const raw = {
    status: "OK",
    data: {
      devices: {
        items: [
          {
            number: "A1",
            serial: "RZ8",
            imei: "35",
            androidVersion: "15",
            description: "mario",
            lastUpdate: 1719400000000,
            info: "{}",
          },
        ],
      },
    },
  };
  const list = parseDeviceSearchResponse(raw);
  assert.equal(list.length, 1);
  assert.equal(list[0].number, "A1");
  assert.equal(list[0].serial, "RZ8");
  assert.equal(list[0].androidVersion, "15");
});

test("parse device search tolerates data.items fallback + empty", () => {
  assert.equal(parseDeviceSearchResponse({ data: { items: [] } }).length, 0);
  assert.equal(parseDeviceSearchResponse({ data: {} }).length, 0);
  assert.equal(parseDeviceSearchResponse({}).length, 0);
});

test("parse deviceinfo payload (model + apps)", () => {
  const raw = {
    data: {
      model: "Pixel 8",
      serial: "RZ8",
      androidVersion: "15",
      batteryLevel: 80,
      applications: [
        { applicationPkg: "com.whatsapp", applicationName: "WhatsApp", versionInstalled: "2.26" },
        { applicationName: "no-pkg" }, // dropped: missing applicationPkg
      ],
    },
  };
  const di = parseDeviceInfoResponse(raw)!;
  assert.equal(di.model, "Pixel 8");
  assert.equal(di.applications.length, 1);
  assert.equal(di.applications[0].applicationPkg, "com.whatsapp");
});

test("parse deviceinfo null when no data", () => {
  assert.equal(parseDeviceInfoResponse({}), null);
});

test("parseInfoBlob: apps from info blob (pkg/name/version), serial unknown->null", () => {
  const info = JSON.stringify({
    model: "SM-S938B",
    androidVersion: "16",
    serial: "unknown",
    batteryLevel: 89,
    applications: [
      { name: "Chrome", pkg: "com.android.chrome", version: "120" },
      { name: "no-pkg-app" },
    ],
  });
  const di = parseInfoBlob(info)!;
  assert.equal(di.model, "SM-S938B");
  assert.equal(di.androidVersion, "16");
  assert.equal(di.serial, null); // "unknown" normalizzato a null
  assert.equal(di.batteryLevel, 89);
  assert.equal(di.applications.length, 1);
  assert.equal(di.applications[0].applicationPkg, "com.android.chrome");
  assert.equal(di.applications[0].applicationName, "Chrome");
  assert.equal(di.applications[0].versionInstalled, "120");
});

test("parseInfoBlob: null/invalid → null", () => {
  assert.equal(parseInfoBlob(null), null);
  assert.equal(parseInfoBlob("not json"), null);
});
