import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkLatencyAnomaly,
  checkMacFlip,
  checkNewUnknownHosts,
  checkPortChanges,
  checkUptimeAnomaly,
  type HostForAnomaly,
  type ScanHistoryForAnomaly,
} from "../anomaly";

const now = Date.UTC(2026, 10, 11, 12);
const host: HostForAnomaly = {
  id: 1, network_id: 1, ip: "192.0.2.10", mac: "00:01:02:03:04:05", vendor: null,
  known_host: 0, status: "online", first_seen: "2026-11-11 11:55:00", open_ports: '[{"port":"445"}]',
};

test("segnala un nuovo host con first_seen SQLite e riconosce la porta nell'inventario", () => {
  const events = checkNewUnknownHosts([
    host,
    { ...host, id: 2, first_seen: "2026-11-11 10:59:59" },
    { ...host, id: 3, first_seen: "2026-11-11T12:00:01Z" },
    { ...host, id: 4, known_host: 1 },
  ], now);
  assert.deepEqual(events.map(({ host_id, anomaly_type, severity }) => [host_id, anomaly_type, severity]), [
    [1, "new_unknown_host", "high"],
  ]);
});

function scansForHost(...scans: Array<Pick<ScanHistoryForAnomaly, "timestamp" | "ports_open"> & { scan_type?: string }>) {
  return new Map([[host.id, scans.map((scan) => ({ host_id: host.id, scan_type: "network_discovery", ...scan }))]]);
}

test("confronta le porte storiche in forma di stringa, numero e oggetto in ordine cronologico", () => {
  const events = checkPortChanges(scansForHost(
    { timestamp: "2026-11-11T12:15:00+02:00", ports_open: '[{"port":80},80]' },
    { timestamp: "2026-11-11 11:00:00", ports_open: '["80","445"]' },
  ), [{ ...host, known_host: 1 }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "high");
  assert.match(events[0].description, /\+445$/);
});

test("evita confronti con uno storico di tipo diverso o un elenco di porte incompleto", () => {
  const precedente = { timestamp: "2026-11-11 10:00:00", ports_open: "[80,445]" };
  assert.deepEqual(checkPortChanges(scansForHost(
    precedente,
    { timestamp: "2026-11-11 11:00:00", ports_open: "[80]", scan_type: "nmap" },
  ), [host]), []);
  assert.deepEqual(checkPortChanges(scansForHost(
    precedente,
    { timestamp: "2026-11-11 11:00:00", ports_open: '[80,"sconosciuta"]' },
  ), [host]), []);
});

test("il controllo MAC interpreta come UTC la prima osservazione SQLite", () => {
  const arp = [{ host_id: 1, ip: host.ip, mac: "00:01:02:03:04:06", timestamp: "2026-11-11 11:59:00" }];
  assert.deepEqual(checkMacFlip([host], arp, now), []);
  assert.equal(checkMacFlip([{ ...host, first_seen: "2026-11-11 10:59:00" }], arp, now).length, 1);
});

test("la disponibilità usa il confine esatto delle 48 ore e indica la direzione corretta", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    host_id: 1, response_time_ms: null, status: index < 5 ? "offline" : "online",
    checked_at: index < 5 ? "2026-11-09 12:00:00" : "2026-11-08 12:00:00",
  }));
  const event = checkUptimeAnomaly(1, 1, host.ip, history, now);
  assert.match(event?.description ?? "", /Disponibilità diminuita/);
});

test("la latenza accetta campioni SQLite ai confini delle finestre di 24 e 72 ore", () => {
  const history = Array.from({ length: 13 }, (_, index) => ({
    time: index < 10 ? "2026-11-08 12:00:00" : "2026-11-10 12:00:00",
    status: "online", response_time_ms: index < 10 ? 9 + index % 2 : 30,
  }));
  const event = checkLatencyAnomaly(1, 1, host.ip, history, now);
  assert.equal(event?.severity, "high");
});
