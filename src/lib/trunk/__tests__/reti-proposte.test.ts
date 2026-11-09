import { test } from "node:test";
import assert from "node:assert/strict";
import { filtraProposte, siSovrappongono } from "../reti-proposte";
import type { TrunkReteMatrice } from "../sensore-trunk";

const rete = (vid: number, cidr: string, ip: number, attiviUltimo = 1): TrunkReteMatrice => ({
  vid, cidr, gateway_ip: null, fonte: null, maschera: "dedotta", blocchi: [cidr], dedotta: cidr,
  ip: Array.from({ length: ip }, (_, i) => ({ ip: `x${i}` })) as unknown as TrunkReteMatrice["ip"],
  serie: [{ giorno: "08/11", noti: 1, nuovi: 0, attivi: 1 }, { giorno: "09/11", noti: 1, nuovi: 0, attivi: attiviUltimo }],
});

test("sovrapposizione: contenuta, uguale, vicina", () => {
  assert.equal(siSovrappongono("172.17.16.0/20", "172.17.20.0/24"), true);
  assert.equal(siSovrappongono("10.0.0.0/24", "10.0.0.0/24"), true);
  assert.equal(siSovrappongono("10.0.0.0/24", "10.0.1.0/24"), false);
});

test("proposte: escluse quelle già in DA-IPAM e 169.254, prima le più popolate", () => {
  const p = filtraProposte(
    [rete(10, "172.17.20.0/24", 3), rete(20, "192.168.20.0/24", 9, 0), rete(0, "169.254.0.0/16", 50), rete(30, "10.30.0.0/24", 2)],
    ["172.17.16.0/20"],
  );
  assert.deepEqual(p.map((x) => x.cidr), ["192.168.20.0/24", "10.30.0.0/24"]);
  assert.equal(p[0].ultimoGiorno, "08/11");
  assert.equal(p[1].ultimoGiorno, "09/11");
});
