import { test } from "node:test";
import assert from "node:assert/strict";
import type os from "node:os";
import { dnsDa, leggiReteAppliance, rottaDiDefault } from "../rete-appliance";

const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
ens18\t00000000\t0128A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0
ens18\t0028A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0
`;

const IF = {
  ens18: [{ address: "192.168.40.9", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "192.168.40.9/24" }],
} as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;

function file(m: Record<string, string>) {
  return (p: string): string => {
    if (p in m) return m[p];
    throw new Error("ENOENT");
  };
}

test("legge rotta, indirizzo e DNS veri", () => {
  const r = leggiReteAppliance({
    leggiFile: file({
      "/proc/net/route": ROUTE,
      "/run/systemd/resolve/resolv.conf": "nameserver 192.168.4.1\nnameserver 192.168.4.1\n",
      "/etc/resolv.conf": "nameserver 127.0.0.53\n",
    }),
    interfacce: () => IF,
  });
  assert.deepEqual(r, { interfaccia: "ens18", ip_cidr: "192.168.40.9/24", gateway: "192.168.40.1", dns: ["192.168.4.1"] });
});

test("senza rotta, senza indirizzo o senza /proc non parte niente", () => {
  assert.equal(leggiReteAppliance({ leggiFile: file({}), interfacce: () => IF }), null);
  assert.equal(leggiReteAppliance({ leggiFile: file({ "/proc/net/route": ROUTE }), interfacce: () => ({}) }), null);
  assert.equal(rottaDiDefault("Iface\n"), null);
  assert.equal(rottaDiDefault("x\nens18;rm\t00000000\t0128A8C0\t0003\t0\t0\t0\t00000000"), null);
});

test("i DNS sono al massimo tre e mai lo stub locale", () => {
  assert.deepEqual(dnsDa("nameserver 127.0.0.53\nnameserver 1.1.1.1\nnameserver 2.2.2.2\nnameserver 3.3.3.3\nnameserver 4.4.4.4\nnameserver x"), ["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
});
