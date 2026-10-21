/**
 * Pool DHCP dalle uscite vere del router (fixture anonimizzate del Task 1): dal comando alla percentuale d'uso.
 * Incidente (2026-10): la Panoramica non mostrava i pool; e `/ip dhcp-server print terse` segna i server spenti con
 * il flag «X» in testa, non con `disabled=yes`, quindi tutti sembravano accesi.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/mikrotik-dhcp-pool.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMikrotikDhcpPools, parseMikrotikDhcpServers } from "../router-client";
import { dimensioneRanges, poolDhcp } from "@/lib/scheda/router";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");

describe("server DHCP (terse vero)", () => {
  const s = parseMikrotikDhcpServers(fx("mikrotik-dhcp-server-terse.txt"));
  it("otto server, col pool giusto", () => {
    assert.equal(s.length, 8);
    assert.equal(s[0].name, "DHCP_SRV01");
    assert.equal(s[0].interface, "VL_5_ZONA03");
    assert.equal(s[0].addressPool, "dhcp_pool01");
  });
  it("il flag X in testa = spento (3 su 8)", () => {
    assert.deepEqual(s.filter((x) => x.disabled).map((x) => x.name), ["DHCP_SRV02", "DHCP_SRV04", "DHCP_SRV06"]);
  });
  it("disabled=yes esplicito resta valido", () => {
    const [x] = parseMikrotikDhcpServers(" 0 name=A interface=e1 address-pool=p disabled=yes");
    assert.equal(x.disabled, true);
  });
});

describe("pool DHCP (terse vero)", () => {
  const p = parseMikrotikDhcpPools(fx("mikrotik-ip-pool-terse.txt"));
  it("otto pool con i ranges", () => {
    assert.equal(p.length, 8);
    assert.equal(p[0].name, "dhcp_pool05");
    assert.equal(p[0].ranges, "10.20.3.121-10.20.3.189");
    assert.equal(dimensioneRanges(p[0].ranges), 69);
  });
});

describe("dall'uscita del router alla percentuale", () => {
  const servers = parseMikrotikDhcpServers(fx("mikrotik-dhcp-server-terse.txt"));
  const pools = parseMikrotikDhcpPools(fx("mikrotik-ip-pool-terse.txt"));
  it("cinque server accesi, ognuno col suo pool; i tre spenti non entrano", () => {
    const uso = poolDhcp(servers, pools, { DHCP_SRV05: 35, DHCP_SRV01: 99 });
    assert.equal(uso.length, 5);
    assert.deepEqual(uso.map((u) => u.server).sort(), ["DHCP_SRV01", "DHCP_SRV03", "DHCP_SRV05", "DHCP_SRV07", "DHCP_SRV08"]);
    const s5 = uso.find((u) => u.server === "DHCP_SRV05");
    assert.equal(s5?.totale, 69);
    assert.equal(s5?.usati, 35);
    assert.equal(s5?.percento, 51);
  });
});
