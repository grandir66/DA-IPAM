// Costruttori di righe per le prove del modello (condivisi: un .test.ts non si importa).
import type { ModelDeviceRow, ModelHostRow, TopologyModelInput } from "@/lib/topology/model-types";

export function dev(id: number, over: Partial<ModelDeviceRow> = {}): ModelDeviceRow {
  return {
    id, name: `SW-${id}`, host: `10.0.0.${id}`, device_type: "switch", vendor: "ubiquiti", model: null, enabled: 1,
    host_id: null, physical_device_id: null, location_id: null, controller_mac: null, uplink_mac: null,
    uplink_remote_port: null, uplink_seen_at: null, uplink_type: null, topology_hidden: 0, port_count: 8, ...over,
  };
}
export function host(id: number, over: Partial<ModelHostRow> = {}): ModelHostRow {
  return {
    id, network_id: 1, ip: `10.0.1.${id}`, mac: null, hostname: null, custom_name: null,
    classification: "server", status: "online", physical_device_id: null, ...over,
  };
}

/** Ingresso del modello vuoto, con l'orologio fisso: le prove aggiungono solo ciò che serve. */
export function baseInput(over: Partial<TopologyModelInput> = {}): TopologyModelInput {
  return {
    devices: [], hosts: [], neighbors: [], uplinkPorts: [], locations: [], networks: [], knownMacs: [], overrides: [],
    macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [],
    nowMs: Date.parse("2026-10-13T12:00:00Z"), staleDays: 2, ...over,
  };
}
