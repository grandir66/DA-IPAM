/**
 * Client per le API REST di LibreNMS (v0).
 * Documentazione: https://docs.librenms.org/API/
 */
import type { LibreNMSDevice } from "@/types";

export class LibreNMSClient {
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    this.baseUrl = url.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v0${path}`, {
      method,
      headers: {
        "X-Auth-Token": this.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      let msg = `LibreNMS API error ${res.status}`;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) msg += `: ${err.message}`;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    return res.json() as Promise<T>;
  }

  /** Lista tutti i device registrati in LibreNMS */
  async getDevices(): Promise<LibreNMSDevice[]> {
    const data = await this.request<{ devices: LibreNMSDevice[] }>("GET", "/devices");
    return data.devices ?? [];
  }

  /** Cerca un device per IP/hostname */
  async getDeviceByHostname(hostname: string): Promise<LibreNMSDevice | null> {
    try {
      const data = await this.request<{ devices: LibreNMSDevice[] }>("GET", `/devices/${encodeURIComponent(hostname)}`);
      return data.devices?.[0] ?? null;
    } catch (err) {
      // 404 = device non trovato
      if (err instanceof Error && err.message.includes("404")) return null;
      throw err;
    }
  }

  /**
   * Aggiunge un device a LibreNMS.
   * Ritorna il device_id assegnato.
   */
  async addDevice(payload: {
    hostname: string;
    snmp_disable?: boolean;
    community?: string;
    /** LibreNMS usa "snmpver": "v1" | "v2c" | "v3" */
    snmpver?: "v1" | "v2c" | "v3";
    port?: number;
    transport?: "udp" | "tcp";
    os?: string;
    sysName?: string;
    hardware?: string;
    serial?: string;
    /** forza l'aggiunta anche se il device non risponde a ping */
    force_add?: boolean;
  }): Promise<number> {
    const data = await this.request<Record<string, unknown>>("POST", "/devices", {
      ...payload,
      force_add: payload.force_add ?? true,
    });
    // LibreNMS può restituire il device_id in diversi formati a seconda della versione:
    // - { id: [123] }            — array numerico
    // - { id: ["123"] }          — array di stringhe
    // - { devices: [{ device_id: 123 }] }
    // - { device_id: 123 }
    const idArr = data.id as (string | number)[] | undefined;
    if (Array.isArray(idArr) && idArr.length > 0 && idArr[0] != null) {
      return Number(idArr[0]);
    }
    const devArr = data.devices as Array<{ device_id?: number }> | undefined;
    if (Array.isArray(devArr) && devArr.length > 0 && devArr[0]?.device_id != null) {
      return devArr[0].device_id;
    }
    if (typeof data.device_id === "number") {
      return data.device_id;
    }
    // Fallback: cerca il device appena aggiunto per hostname
    try {
      const found = await this.getDeviceByHostname(payload.hostname);
      if (found) return found.device_id;
    } catch { /* ignore */ }
    throw new Error(`LibreNMS non ha restituito device_id (risposta: ${JSON.stringify(data).slice(0, 300)})`);
  }

  /** Aggiorna attributi di un device esistente */
  async updateDevice(deviceId: number, fields: Record<string, unknown>): Promise<void> {
    await this.request("PATCH", `/devices/${deviceId}`, fields);
  }

  /** Rimuove un device da LibreNMS */
  async deleteDevice(deviceId: number): Promise<void> {
    await this.request("DELETE", `/devices/${deviceId}`);
  }

  /** Stato corrente di un device (status 1=up 0=down, uptime, last_polled) */
  async getDeviceStatus(deviceId: number): Promise<LibreNMSDevice | null> {
    try {
      const data = await this.request<{ devices: LibreNMSDevice[] }>("GET", `/devices/${deviceId}`);
      return data.devices?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Verifica che l'API sia raggiungibile e il token valido */
  async ping(): Promise<boolean> {
    try {
      await this.request("GET", "/devices?limit=1");
      return true;
    } catch {
      return false;
    }
  }
}

/** Crea un client a partire dalla config hub del tenant */
export function createLibreNMSClient(url: string, token: string): LibreNMSClient {
  return new LibreNMSClient(url, token);
}
