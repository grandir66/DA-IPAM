import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSysObjCategory } from "../sysobj-category";
import type { SysObjMatch } from "@/lib/scanner/snmp-sysobj-lookup";

function m(product: string, category: string, vendor = "Ubiquiti"): SysObjMatch {
  return { vendor, product, category, enterpriseId: 41112 };
}

test("wireless → access_point (UniFi AP)", () => {
  assert.equal(mapSysObjCategory(m("UniFi AP (UAP serie)", "wireless")), "access_point");
});

test("networking + prodotto switch → switch (UniFi Switch)", () => {
  assert.equal(mapSysObjCategory(m("UniFi Switch (USW serie)", "networking")), "switch");
});

test("networking + prodotto router → router (MikroTik CCR)", () => {
  assert.equal(
    mapSysObjCategory(m("RouterOS — CCR serie (Cloud Core Router)", "networking", "MikroTik")),
    "router",
  );
});

test("switch vince su router quando il prodotto contiene entrambi (CRS)", () => {
  assert.equal(
    mapSysObjCategory(m("RouterOS — CRS (Cloud Router Switch)", "networking", "MikroTik")),
    "switch",
  );
});

test("Catalyst → switch, ISR → router", () => {
  assert.equal(mapSysObjCategory(m("Catalyst 2960 serie", "networking", "Cisco")), "switch");
  assert.equal(mapSysObjCategory(m("ISR 4000 serie", "networking", "Cisco")), "router");
});

test("categorie già valide passano invariate", () => {
  assert.equal(mapSysObjCategory(m("UniFi Security Gateway (USG)", "firewall")), "firewall");
  assert.equal(mapSysObjCategory(m("Synology DSM", "storage", "Synology")), "storage");
  assert.equal(mapSysObjCategory(m("iLO 5", "server", "HPE")), "server");
});

test("networking ambiguo → undefined (lascia decidere alla cascade)", () => {
  assert.equal(mapSysObjCategory(m("TP-Link / Omada generico", "networking", "TP-Link")), undefined);
});

test("categoria vuota o sconosciuta → undefined", () => {
  assert.equal(mapSysObjCategory(m("Qualcosa", "")), undefined);
  assert.equal(mapSysObjCategory(m("Qualcosa", "banana")), undefined);
});
