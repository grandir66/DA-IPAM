// Un AP in mesh (esce via radio, non via cavo) nella forma vera di stat/device,
// per le prove del tipo di uplink (topologia fase 2b, Task 3).
//
// Si costruisce qui, a partire da AP-3 della fixture, invece di aggiungerlo a
// `fixtures/unifi-stat-device.json`: quella è la risposta vera ridotta a quattro
// apparati e più di venti prove (sync, controller, API, certificato) contano su
// quel quattro. Valori inventati: MAC 02:00:00:…, nomi AP-n, IP della fixture.
import fs from "node:fs";
import path from "node:path";

const FIXTURE = path.join(__dirname, "..", "fixtures", "unifi-stat-device.json");

/** Il record grezzo di un AP «AP-4» appeso via radio ad AP-3 (`uplink.type = "wireless"`). */
export function rawApInMesh(): Record<string, unknown> {
  const grezzo = JSON.parse(fs.readFileSync(FIXTURE, "utf-8")) as { data: Array<Record<string, unknown>> };
  const ap3 = grezzo.data.find((x) => x.name === "AP-3");
  if (!ap3) throw new Error("AP-3 assente dalla fixture");
  return {
    ...structuredClone(ap3),
    name: "AP-4",
    mac: "02:00:00:00:00:2a",
    ip: "10.99.0.30",
    serial: "SN000005",
    lldp_table: [],
    port_table: [],
    // Forma dell'uplink radio come la manda il controller: niente porta remota,
    // il MAC dell'AP a cui si appoggia, radio e segnale.
    uplink: {
      ap_mac: "02:00:00:00:00:05",
      channel: 48,
      name: "ath2",
      radio: "na",
      rssi: 31,
      rx_rate: 866700,
      signal: -65,
      tx_rate: 866700,
      type: "wireless",
      up: true,
      uplink_device_name: "AP-3",
      uplink_mac: "02:00:00:00:00:05",
    },
    last_uplink: { uplink_mac: "02:00:00:00:00:05", type: "wireless" },
  };
}
