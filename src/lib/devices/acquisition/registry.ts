/**
 * Registry acquisizione dispositivi.
 *
 * Seleziona l'handler di acquisizione in base a (vendor, vendor_subtype, classification, protocol).
 * Gli handler espongono operazioni uniformi: getMacTable, getPortSchema, getArpTable, getDeviceInfo, testConnection.
 *
 * Questa architettura separa la logica di acquisizione vendor-specifica dalla facciata `switch-client.ts`
 * e `router-client.ts`, permettendo estensioni modulari senza modificare i file monolitici.
 */

import type { NetworkDevice } from "@/types";
import type { MacTableEntry, PortInfo, SwitchClient } from "../switch-client";
import type { ArpTableEntry, RouterClient } from "../router-client";

export interface DeviceInfo {
  sysname?: string | null;
  sysdescr?: string | null;
  model?: string | null;
  firmware?: string | null;
  serial_number?: string | null;
  part_number?: string | null;
  uptime?: string | null;
  extra?: Record<string, unknown>;
}

export interface AcquisitionHandler {
  vendor: NetworkDevice["vendor"];
  vendorSubtype?: NetworkDevice["vendor_subtype"];
  classification?: string | null;
  protocol?: NetworkDevice["protocol"];
  priority: number;

  getMacTable?(device: NetworkDevice): Promise<MacTableEntry[]>;
  getPortSchema?(device: NetworkDevice): Promise<PortInfo[]>;
  getArpTable?(device: NetworkDevice): Promise<ArpTableEntry[]>;
  getDeviceInfo?(device: NetworkDevice): Promise<DeviceInfo | null>;
  testConnection?(device: NetworkDevice): Promise<boolean>;
}

type HandlerFactory = () => AcquisitionHandler;

const handlers: HandlerFactory[] = [];

export function registerHandler(factory: HandlerFactory): void {
  handlers.push(factory);
}

function matchScore(handler: AcquisitionHandler, device: NetworkDevice): number {
  let score = 0;
  if (handler.vendor === device.vendor) score += 100;
  else if (handler.vendor === "other") score += 1;
  else return -1;

  if (handler.vendorSubtype !== undefined) {
    if (handler.vendorSubtype === device.vendor_subtype) score += 50;
    else return -1;
  }

  if (handler.classification !== undefined && handler.classification !== null) {
    if (handler.classification === device.classification) score += 25;
    else return -1;
  }

  if (handler.protocol !== undefined) {
    if (handler.protocol === device.protocol) score += 10;
    else return -1;
  }

  score += handler.priority;
  return score;
}

export function findHandler(device: NetworkDevice): AcquisitionHandler | null {
  const candidates = handlers.map((f) => {
    const h = f();
    const s = matchScore(h, device);
    return { handler: h, score: s };
  }).filter((c) => c.score >= 0);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].handler;
}

export function buildSwitchClientFromHandler(handler: AcquisitionHandler, device: NetworkDevice): SwitchClient | null {
  if (!handler.getMacTable && !handler.getPortSchema && !handler.testConnection) {
    return null;
  }

  return {
    async getMacTable(): Promise<MacTableEntry[]> {
      if (handler.getMacTable) return handler.getMacTable(device);
      return [];
    },
    async getPortSchema(): Promise<PortInfo[]> {
      if (handler.getPortSchema) return handler.getPortSchema(device);
      return [];
    },
    async getStpInfo() {
      return null;
    },
    async testConnection(): Promise<boolean> {
      if (handler.testConnection) return handler.testConnection(device);
      return false;
    },
  };
}

export function buildRouterClientFromHandler(handler: AcquisitionHandler, device: NetworkDevice): RouterClient | null {
  if (!handler.getArpTable && !handler.testConnection) {
    return null;
  }

  return {
    async getArpTable(): Promise<ArpTableEntry[]> {
      if (handler.getArpTable) return handler.getArpTable(device);
      return [];
    },
    async testConnection(): Promise<boolean> {
      if (handler.testConnection) return handler.testConnection(device);
      return false;
    },
  };
}

export function getRegisteredHandlers(): AcquisitionHandler[] {
  return handlers.map((f) => f());
}
