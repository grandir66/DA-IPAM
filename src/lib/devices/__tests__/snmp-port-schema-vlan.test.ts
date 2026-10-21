// Incidente 21/10: su SW-ING-ProMax-239 `dot1dBasePortIfIndex` è vuota ma `dot1qPvid` ha 32 righe: la VLAN veniva scartata.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSnmpPortSchema } from "@/lib/devices/snmp-port-schema";

const riga = (base: string, idx: number, value: number | string) => ({ oid: `${base}.${idx}`, value });

function walkFinto(bridgeMap: Array<[number, number]>) {
  const tabelle: Record<string, { oid: string; value: number | string }[]> = {
    "1.3.6.1.2.1.2.2.1.2": [riga("1.3.6.1.2.1.2.2.1.2", 1, "Port 1"), riga("1.3.6.1.2.1.2.2.1.2", 2, "Port 2")],
    "1.3.6.1.2.1.2.2.1.8": [riga("1.3.6.1.2.1.2.2.1.8", 1, 1), riga("1.3.6.1.2.1.2.2.1.8", 2, 1)],
    "1.3.6.1.2.1.17.7.1.4.5.1.1": [riga("1.3.6.1.2.1.17.7.1.4.5.1.1", 1, 20), riga("1.3.6.1.2.1.17.7.1.4.5.1.1", 2, 30)],
    "1.3.6.1.2.1.17.2.15.1.3": [riga("1.3.6.1.2.1.17.2.15.1.3", 1, 5)],
    "1.3.6.1.2.1.17.1.4.1.2": bridgeMap.map(([bp, ifx]) => riga("1.3.6.1.2.1.17.1.4.1.2", bp, ifx)),
  };
  return async (oid: string) => tabelle[oid] ?? [];
}

test("mappa bridge vuota: la VLAN si legge con l'indice del pvid come ifIndex (anche STP)", async () => {
  const porte = await getSnmpPortSchema(walkFinto([]));
  assert.equal(porte.find((p) => p.port_index === 1)?.vlan, 20);
  assert.equal(porte.find((p) => p.port_index === 2)?.vlan, 30);
  assert.equal(porte.find((p) => p.port_index === 1)?.stp_state, "forwarding");
});

test("mappa bridge presente: comportamento invariato (si passa dalla porta di bridge)", async () => {
  // bridge port 11 → ifIndex 1; il pvid sta sulla porta di bridge 11, non sull'ifIndex
  const tab = walkFinto([[11, 1]]);
  const walk = async (oid: string) => oid === "1.3.6.1.2.1.17.7.1.4.5.1.1"
    ? [riga(oid, 11, 99)]
    : tab(oid);
  const porte = await getSnmpPortSchema(walk);
  assert.equal(porte.find((p) => p.port_index === 1)?.vlan, 99);
  assert.equal(porte.find((p) => p.port_index === 2)?.vlan, null); // ifIndex 2 non è nella mappa: nessun ripiego
});
