/**
 * La rete dell'appliance proposta come prima subnet del wizard (24/10).
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/rete-appliance.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  baseDnDaDominio,
  campiReteProposti,
  cidrDaIndirizzo,
  ipDentroCidr,
  leggiResolvConf,
  propostaReteAppliance,
  rottePredefinite,
  type Interfacce,
} from "../rete-appliance";

const ROTTE = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "eth0\t00000000\t0163A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
  "eth0\t0063A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
  "docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
].join("\n");

const lan = (address: string, netmask = "255.255.255.0") => ({ address, netmask, family: "IPv4", internal: false });

const INTERFACCE: Interfacce = {
  lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
  docker0: [lan("172.17.0.1", "255.255.0.0")],
  wt0: [lan("100.92.10.4", "255.255.0.0")],
  eth0: [lan("192.168.99.110"), { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false }],
};

describe("cidrDaIndirizzo", () => {
  it("calcola l'indirizzo di rete", () => {
    assert.equal(cidrDaIndirizzo("192.168.99.110", "255.255.255.0"), "192.168.99.0/24");
    assert.equal(cidrDaIndirizzo("10.1.2.3", "255.255.252.0"), "10.1.0.0/22");
  });
  it("rifiuta maschere non contigue o vuote", () => {
    assert.equal(cidrDaIndirizzo("10.1.2.3", "255.0.255.0"), null);
    assert.equal(cidrDaIndirizzo("10.1.2.3", "0.0.0.0"), null);
    assert.equal(cidrDaIndirizzo("ciao", "255.255.255.0"), null);
  });
});

describe("ipDentroCidr", () => {
  it("dice se l'IP sta nella rete", () => {
    assert.equal(ipDentroCidr("192.168.99.1", "192.168.99.0/24"), true);
    assert.equal(ipDentroCidr("192.168.98.1", "192.168.99.0/24"), false);
  });
});

describe("rottePredefinite", () => {
  it("legge il gateway di /proc/net/route (little-endian)", () => {
    assert.deepEqual(rottePredefinite(ROTTE), [{ interfaccia: "eth0", gateway: "192.168.99.1", metrica: 100 }]);
  });
  it("niente file = niente rotte", () => {
    assert.deepEqual(rottePredefinite(null), []);
  });
});

describe("leggiResolvConf", () => {
  it("salta il DNS locale di systemd-resolved e prende il dominio", () => {
    const r = leggiResolvConf("# generato\nnameserver 127.0.0.53\nnameserver 192.168.99.10\nnameserver 192.168.99.10\nsearch corp.local\n");
    assert.deepEqual(r, { dns: ["192.168.99.10"], dominio: "corp.local" });
  });
  it("ignora i domini che non dicono niente", () => {
    assert.equal(leggiResolvConf("search localdomain\n").dominio, null);
  });
});

describe("propostaReteAppliance", () => {
  it("propone la LAN della rotta predefinita, non Docker né NetBird", () => {
    const p = propostaReteAppliance({
      interfacce: INTERFACCE,
      rotte: ROTTE,
      resolv: ["nameserver 127.0.0.53\n", "nameserver 192.168.99.10\nnameserver 1.1.1.1\nsearch corp.local\n"],
    });
    assert.deepEqual(p, {
      interfaccia: "eth0",
      ip: "192.168.99.110",
      cidr: "192.168.99.0/24",
      gateway: "192.168.99.1",
      dns: ["192.168.99.10", "1.1.1.1"],
      dominio: "corp.local",
    });
  });

  it("l'IP dichiarato dall'installatore vince sulla rotta predefinita", () => {
    const p = propostaReteAppliance({
      interfacce: { ...INTERFACCE, ens19: [lan("10.20.0.5")] },
      rotte: ROTTE,
      resolv: [],
      ipDichiarato: "10.20.0.5",
    });
    assert.equal(p?.interfaccia, "ens19");
    assert.equal(p?.cidr, "10.20.0.0/24");
    // Il gateway della rotta sta su un'altra rete: non si propone.
    assert.equal(p?.gateway, null);
  });

  it("senza rotte prende la prima LAN; senza LAN non propone niente", () => {
    assert.equal(propostaReteAppliance({ interfacce: INTERFACCE, rotte: null, resolv: [] })?.cidr, "192.168.99.0/24");
    assert.equal(propostaReteAppliance({ interfacce: { lo: INTERFACCE.lo, docker0: INTERFACCE.docker0 }, rotte: ROTTE, resolv: [] }), null);
  });

  it("salta gli indirizzi link-local", () => {
    assert.equal(propostaReteAppliance({ interfacce: { eth0: [lan("169.254.3.4", "255.255.0.0")] }, rotte: null, resolv: [] }), null);
  });
});

describe("campi per il wizard", () => {
  it("un solo DNS per la rete, gateway vuoto se manca", () => {
    assert.deepEqual(
      campiReteProposti({ interfaccia: "eth0", ip: "10.0.0.2", cidr: "10.0.0.0/24", gateway: null, dns: ["10.0.0.1", "8.8.8.8"], dominio: null }),
      { cidr: "10.0.0.0/24", gateway: "", dns: "10.0.0.1" },
    );
  });
  it("Base DN dal dominio", () => {
    assert.equal(baseDnDaDominio("corp.local"), "DC=corp,DC=local");
  });
});
