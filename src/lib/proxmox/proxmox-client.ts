/**
 * Proxmox VE API Client
 *
 * Estrae dati da hypervisor Proxmox (host, nodi, VM, LXC) per popolare inventario.
 * Logica ispirata a Proxreporter (https://github.com/grandir66/Proxreporter).
 * Uso locale: nessun invio dati, solo estrazione e visualizzazione.
 */

import http from "http";
import https from "https";

export interface ProxmoxConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  verifySsl?: boolean;
}

export interface ProxmoxNodeInfo {
  node: string;
  status: string;
  cpu: number | null;
  maxcpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
  ssl_fingerprint?: string;
}

export interface ProxmoxSubscriptionInfo {
  status: string;
  productname: string | null;
  regdate: string | null;
  nextduedate: string | null;
  level: string | null;
  key: string | null;
  serverid: string | null;
  sockets: number | null;
  checktime: string | null;
}

export interface ProxmoxHostInfo {
  hostname: string;
  status: string;
  uptime_seconds: number | null;
  uptime_human: string | null;
  cpu_model: string | null;
  cpu_mhz: number | null;
  cpu_sockets: number | null;
  cpu_cores: number | null;
  cpu_total_cores: number | null;
  memory_total_gb: number | null;
  memory_used_gb: number | null;
  memory_free_gb: number | null;
  memory_usage_percent: number | null;
  proxmox_version: string | null;
  kernel_version: string | null;
  rootfs_total_gb: number | null;
  rootfs_used_gb: number | null;
  storage: ProxmoxStorageInfo[];
  network_interfaces: ProxmoxNetworkInterface[];
  subscription: ProxmoxSubscriptionInfo | null;
  hardware_serial: string | null;
  hardware_model: string | null;
  hardware_manufacturer: string | null;
}

export interface ProxmoxStorageInfo {
  name: string;
  type: string;
  status: string;
  total_gb: number | null;
  used_gb: number | null;
  available_gb: number | null;
  content: string;
}

export interface ProxmoxNetworkInterface {
  name: string;
  type: string;
  state: string;
  mac_address: string | null;
  ip_addresses: string | null;
  bridge: string | null;
  vlan_id: string | number | null;
  speed_mbps: string | null;
}

export interface ProxmoxVM {
  node: string;
  vmid: number;
  name: string;
  status: string;
  type: "qemu" | "lxc";
  maxcpu: number;
  cores: number;
  sockets: number;
  maxmem: number;
  memory_mb: number;
  maxdisk: number;
  disk_gb: number;
  ip_addresses: string[];
  disks_details: { id: string; storage: string; size?: string }[];
  networks_details: { id: string; model?: string; mac?: string; bridge?: string; vlan?: string }[];
  bios?: string;
  machine?: string;
  agent?: string;
}

function bytesToGib(value: number): number {
  return value / (1024 ** 3);
}

function secondsToHuman(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function safeRound(value: number, digits = 2): number {
  return Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
}

/** Crea agent HTTPS che ignora certificati self-signed (tipico Proxmox) */
function createAgent(verifySsl = false): https.Agent {
  return new https.Agent({
    rejectUnauthorized: verifySsl,
    // Evita EPROTO "wrong version number": compatibilità con Proxmox e OpenSSL legacy
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
    // Permette cert con SHA-1 / chiavi deboli (Proxmox self-signed)
    ciphers: "DEFAULT:@SECLEVEL=0",
  });
}

/** Estrae host, porta e protocollo da una stringa (IP, hostname o URL completo) */
function parseHost(hostOrUrl: string): { host: string; port: number; useHttps: boolean } {
  let s = hostOrUrl.trim();
  const defaultPort = 8006;
  let useHttps = true;
  if (s.toLowerCase().startsWith("http://")) {
    useHttps = false;
    s = s.slice(7);
  } else if (s.toLowerCase().startsWith("https://")) {
    s = s.slice(8);
  }
  s = s.replace(/^\/+/, "");
  const portMatch = s.match(/:(\d+)$/);
  if (portMatch) {
    return { host: s.slice(0, -portMatch[0].length), port: parseInt(portMatch[1], 10), useHttps };
  }
  return { host: s, port: defaultPort, useHttps };
}

export class ProxmoxClient {
  private baseUrl: string;
  private config: ProxmoxConfig;
  private ticket: string | null = null;
  private csrfToken: string | null = null;
  private agent: https.Agent | undefined;
  private useHttps: boolean;

  constructor(config: ProxmoxConfig) {
    const { host: parsedHost, port: parsedPort, useHttps } = parseHost(config.host);
    const port = config.port ?? parsedPort;
    const host = parsedHost || config.host;
    this.config = config;
    this.useHttps = useHttps;
    this.baseUrl = `${useHttps ? "https" : "http"}://${host}:${port}/api2/json`;
    this.agent = useHttps ? createAgent(config.verifySsl ?? false) : undefined;
  }

  private async request<T>(method: string, path: string, body?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (this.ticket && this.csrfToken) {
      // Il ticket può contenere caratteri speciali: URL-encode come in Proxmox API (DA-PXREPL)
      headers["Cookie"] = `PVEAuthCookie=${encodeURIComponent(this.ticket)}`;
      headers["CSRFPreventionToken"] = this.csrfToken;
    }

    let bodyBuffer: Buffer | null = null;
    if (body && (method === "POST" || method === "PUT")) {
      const bodyStr = new URLSearchParams(body).toString();
      bodyBuffer = Buffer.from(bodyStr, "utf8");
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(bodyBuffer.length);
    }

    const options: https.RequestOptions & { agent?: https.Agent } = {
      method,
      headers,
    };
    if (this.agent) options.agent = this.agent;

    return new Promise((resolve, reject) => {
      const requestFn = this.useHttps ? https.request : http.request;
      const req = requestFn(url, options, (res) => {
        let data = "";
        const status = res.statusCode ?? 0;
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const trimmed = data.trim();
            if (!trimmed) {
              if (status >= 300 && status < 400) {
                const loc = res.headers.location ?? "";
                reject(new Error(`Redirect (${status}) a ${loc || "URL sconosciuto"}. Usa l'URL finale diretto (es. https://ip:8006).`));
              } else if (status === 401) {
                reject(new Error("Credenziali non valide. Verifica username (es. root@pam) e password."));
              } else if (status === 403) {
                reject(new Error("Accesso negato (403). Verifica permessi utente Proxmox."));
              } else if (status === 404) {
                reject(new Error("Endpoint non trovato (404). Verifica che l'API Proxmox sia attiva sulla porta 8006."));
              } else if (status >= 400) {
                reject(new Error(`Errore server Proxmox: HTTP ${status}. Verifica configurazione.`));
              } else {
                reject(new Error("Risposta vuota dal server Proxmox. Verifica connettività, URL (https://host:8006) e credenziali."));
              }
              return;
            }
            const parsed = JSON.parse(trimmed);
            if (parsed.errors && parsed.errors.length > 0) {
              reject(new Error(parsed.errors[0]?.message ?? "Errore API Proxmox"));
              return;
            }
            resolve((parsed.data ?? parsed) as T);
          } catch {
            const preview = data.slice(0, 150).replace(/\s+/g, " ").trim();
            if (data.startsWith("<") || data.toLowerCase().includes("html")) {
              reject(new Error("Il server ha restituito HTML invece di JSON. Verifica URL e che sia l'API Proxmox (porta 8006)."));
            } else if (preview) {
              reject(new Error(`Risposta non valida: ${preview}${data.length > 150 ? "…" : ""}`));
            } else {
              reject(new Error("Risposta non valida dal server Proxmox."));
            }
          }
        });
      });

      req.on("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        const msg = (err as Error).message;
        if (code === "EPROTO" || msg?.includes("wrong version number")) {
          reject(new Error(
            "Errore SSL: il server non ha risposto con TLS. Prova http:// invece di https:// nell'URL (es. http://ip:8006) se Proxmox è in HTTP, oppure verifica porta 8006."
          ));
        } else {
          reject(err);
        }
      });
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error("Timeout connessione Proxmox"));
      });

      if (bodyBuffer) {
        req.write(bodyBuffer);
      }
      req.end();
    });
  }

  async login(): Promise<void> {
    const result = await this.request<{ ticket: string; CSRFPreventionToken: string }>(
      "POST",
      "/access/ticket",
      {
        username: this.config.username,
        password: this.config.password,
      }
    );
    this.ticket = result.ticket;
    this.csrfToken = result.CSRFPreventionToken;
  }

  async getNodes(): Promise<ProxmoxNodeInfo[]> {
    const data = await this.request<ProxmoxNodeInfo[]>("GET", "/nodes");
    return Array.isArray(data) ? data : [];
  }

  async getNodeStatus(node: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", `/nodes/${node}/status`);
  }

  async getNodeVersion(node: string): Promise<{ version?: string; release?: string }> {
    return this.request<{ version?: string; release?: string }>("GET", `/nodes/${node}/version`);
  }

  /** Licenza/sottoscrizione Proxmox (può fallire su Community Edition) */
  async getNodeSubscription(node: string): Promise<ProxmoxSubscriptionInfo | null> {
    try {
      const data = await this.request<Record<string, unknown>>("GET", `/nodes/${node}/subscription`);
      if (!data) return null;
      return {
        status: String(data.status ?? ""),
        productname: data.productname != null ? String(data.productname) : null,
        regdate: data.regdate != null ? String(data.regdate) : null,
        nextduedate: data.nextduedate != null ? String(data.nextduedate) : null,
        level: data.level != null ? String(data.level) : null,
        key: data.key != null ? String(data.key) : null,
        serverid: data.serverid != null ? String(data.serverid) : null,
        sockets: data.sockets != null ? Number(data.sockets) : null,
        checktime: data.checktime != null ? String(data.checktime) : null,
      };
    } catch {
      return null;
    }
  }

  /** Report sistema: estrae seriale, modello, produttore (l'endpoint può restituire JSON o testo) */
  async getNodeReport(node: string): Promise<{ serial?: string; model?: string; manufacturer?: string }> {
    try {
      const raw = await this.request<unknown>("GET", `/nodes/${node}/report`);
      const result: { serial?: string; model?: string; manufacturer?: string } = {};
      const str = typeof raw === "string" ? raw : (raw && typeof raw === "object" && "data" in raw && typeof (raw as { data: unknown }).data === "string")
        ? (raw as { data: string }).data
        : JSON.stringify(raw);
      const serialMatch = str.match(/Serial Number[:\s]+([^\n\r]+)/i) || str.match(/serial[:\s]+([^\n\r]+)/i);
      const modelMatch = str.match(/Product Name[:\s]+([^\n\r]+)/i) || str.match(/Model[:\s]+([^\n\r]+)/i);
      const mfrMatch = str.match(/Manufacturer[:\s]+([^\n\r]+)/i) || str.match(/Vendor[:\s]+([^\n\r]+)/i);
      if (serialMatch) result.serial = serialMatch[1].trim();
      if (modelMatch) result.model = modelMatch[1].trim();
      if (mfrMatch) result.manufacturer = mfrMatch[1].trim();
      if (raw && typeof raw === "object" && !("data" in raw)) {
        const sections = raw as Record<string, unknown>;
        const sys = sections.system ?? sections["System Information"] ?? sections.dmi;
        if (sys && typeof sys === "object") {
          const s = sys as Record<string, unknown>;
          if (s.serial_number && !result.serial) result.serial = String(s.serial_number);
          if ((s.product_name || s.model) && !result.model) result.model = String(s.product_name ?? s.model ?? "");
          if ((s.manufacturer || s.vendor) && !result.manufacturer) result.manufacturer = String(s.manufacturer ?? s.vendor ?? "");
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  async getNodeStorage(node: string): Promise<ProxmoxStorageInfo[]> {
    const list = await this.request<Array<{ storage: string; type: string; status?: string; content?: string }>>(
      "GET",
      `/nodes/${node}/storage`
    );
    const result: ProxmoxStorageInfo[] = [];
    for (const s of list || []) {
      let total_gb: number | null = null;
      let used_gb: number | null = null;
      let available_gb: number | null = null;
      try {
        const status = await this.request<{ total?: number; used?: number; avail?: number }>(
          "GET",
          `/nodes/${node}/storage/${s.storage}/status`
        );
        if (status?.total) total_gb = bytesToGib(status.total);
        if (status?.used) used_gb = bytesToGib(status.used);
        if (status?.avail) available_gb = bytesToGib(status.avail);
      } catch {
        // ignora errori storage singolo
      }
      result.push({
        name: s.storage,
        type: s.type ?? "unknown",
        status: s.status ?? "unknown",
        total_gb,
        used_gb,
        available_gb,
        content: Array.isArray(s.content) ? s.content.join(", ") : (s.content ?? ""),
      });
    }
    return result;
  }

  async getNodeNetwork(node: string): Promise<ProxmoxNetworkInterface[]> {
    const data = await this.request<Array<Record<string, unknown>>>("GET", `/nodes/${node}/network`);
    const result: ProxmoxNetworkInterface[] = [];
    for (const iface of data || []) {
      const name = (iface.iface ?? iface.name ?? iface.interface) as string;
      if (!name) continue;
      const type = (iface.type ?? "unknown") as string;
      const active = iface.active === true || iface.active === "1";
      const state = active ? "up" : "down";
      const hwaddr = (iface.hwaddr ?? iface.mac ?? iface.address) as string | null;
      const address = (iface.address ?? iface.cidr ?? iface.ip) as string | null;
      const bridge = (iface.bridge ?? iface.bridge_ports) as string | null;
      const vlan = (iface.vlan ?? iface.tag ?? iface.bridge_vids) as string | number | null;
      const speed = (iface.speed ?? iface.speed_mbps) as string | null;
      result.push({
        name,
        type,
        state,
        mac_address: hwaddr ?? null,
        ip_addresses: address ?? null,
        bridge: Array.isArray(bridge) ? bridge.join(", ") : bridge ?? null,
        vlan_id: vlan,
        speed_mbps: speed ? String(speed) : null,
      });
    }
    return result;
  }

  async getHostInfo(node: string): Promise<ProxmoxHostInfo> {
    const [status, version, storage, network, subscription, report] = await Promise.all([
      this.getNodeStatus(node),
      this.getNodeVersion(node),
      this.getNodeStorage(node),
      this.getNodeNetwork(node),
      this.getNodeSubscription(node),
      this.getNodeReport(node),
    ]);

    const memory = status?.memory as Record<string, number> | undefined;
    const memTotal = memory?.total ?? 0;
    const memUsed = memory?.used ?? 0;
    const memFree = memory?.free ?? 0;
    const memTotalGb = bytesToGib(memTotal);
    const memUsedGb = bytesToGib(memUsed);
    const memFreeGb = bytesToGib(memFree);
    const memUsagePct = memTotal ? safeRound((memUsed / memTotal) * 100, 2) : null;

    const rootfs = status?.rootfs as Record<string, number> | undefined;
    const rootTotal = rootfs?.total ?? 0;
    const rootUsed = rootfs?.used ?? 0;

    const cpuinfo = status?.cpuinfo as Record<string, unknown> | undefined;
    const cpuModel = (cpuinfo?.model ?? status?.cpuinfo) as string | null;
    const cpuMhz = (cpuinfo?.mhz ?? status?.mhz ?? cpuinfo?.frequency) as number | null;
    const cpuCores = (cpuinfo?.cores ?? status?.cores) as number | null;
    const cpuSockets = (cpuinfo?.sockets ?? status?.sockets ?? subscription?.sockets) as number | null;
    const maxcpu = (status?.maxcpu ?? status?.cpus ?? cpuinfo?.cpus ?? cpuinfo?.cores) as number | null;

    const uptime = (status?.uptime ?? 0) as number;
    const versionStr = (version?.version ?? version?.release ?? "") as string;
    const kernelMatch = versionStr.match(/running kernel:\s*([^)]+)/i);
    const kernelVersion = kernelMatch ? kernelMatch[1].trim() : (version?.release as string) ?? null;
    const managerMatch = versionStr.match(/pve-manager\/([0-9A-Za-z.\-]+)/i);
    const proxmoxVersion = managerMatch ? managerMatch[1] : versionStr || null;

    return {
      hostname: node,
      status: (status?.status ?? "unknown") as string,
      uptime_seconds: uptime || null,
      uptime_human: uptime ? secondsToHuman(uptime) : null,
      cpu_model: cpuModel ?? null,
      cpu_mhz: cpuMhz != null ? Number(cpuMhz) : null,
      cpu_sockets: cpuSockets != null ? Number(cpuSockets) : null,
      cpu_cores: cpuCores != null ? Number(cpuCores) : null,
      cpu_total_cores: maxcpu ?? null,
      memory_total_gb: memTotalGb || null,
      memory_used_gb: memUsedGb || null,
      memory_free_gb: memFreeGb || null,
      memory_usage_percent: memUsagePct,
      proxmox_version: proxmoxVersion,
      kernel_version: kernelVersion,
      rootfs_total_gb: rootTotal ? bytesToGib(rootTotal) : null,
      rootfs_used_gb: rootUsed ? bytesToGib(rootUsed) : null,
      storage,
      network_interfaces: network,
      subscription,
      hardware_serial: report.serial ?? null,
      hardware_model: report.model ?? null,
      hardware_manufacturer: report.manufacturer ?? null,
    };
  }

  async getVMs(node: string, includeStopped = false): Promise<ProxmoxVM[]> {
    const qemuList = await this.request<Array<Record<string, unknown>>>("GET", `/nodes/${node}/qemu`);
    const vms: ProxmoxVM[] = [];

    for (const vm of qemuList || []) {
      const status = (vm.status ?? "unknown") as string;
      if (!includeStopped && status !== "running") continue;

      const vmid = Number(vm.vmid ?? 0);
      const name = (vm.name ?? `VM-${vmid}`) as string;
      const maxcpu = Number(vm.maxcpu ?? 0);
      const maxmem = Number(vm.maxmem ?? 0);
      const maxdisk = Number(vm.maxdisk ?? 0);

      let config: Record<string, unknown> = {};
      try {
        config = await this.request<Record<string, unknown>>("GET", `/nodes/${node}/qemu/${vmid}/config`);
      } catch {
        // config opzionale
      }

      const cores = Number(config.cores ?? 1);
      const sockets = Number(config.sockets ?? 1);
      const effectiveCpu = maxcpu || cores * sockets;

      const disksDetails: ProxmoxVM["disks_details"] = [];
      const networksDetails: ProxmoxVM["networks_details"] = [];

      for (const [key, val] of Object.entries(config)) {
        if (key.startsWith("scsi") || key.startsWith("sata") || key.startsWith("ide") || key.startsWith("virtio")) {
          const str = String(val ?? "");
          const parts = str.split(",");
          const first = parts[0] ?? "";
          const storage = first.includes(":") ? first.split(":")[0] : "N/A";
          const sizeMatch = parts.find((p) => p.startsWith("size="));
          const size = sizeMatch ? sizeMatch.split("=")[1] : undefined;
          disksDetails.push({ id: key, storage, size });
        }
        if (key.startsWith("net")) {
          const str = String(val ?? "");
          const parts = str.split(",");
          const first = parts[0] ?? "";
          let model: string | undefined;
          let mac: string | undefined;
          if (first.includes("=")) {
            const [m, v] = first.split("=", 2);
            model = m;
            mac = v;
          }
          let bridge: string | undefined;
          let vlan: string | undefined;
          for (const p of parts.slice(1)) {
            if (p.startsWith("bridge=")) bridge = p.split("=")[1];
            if (p.startsWith("tag=")) vlan = p.split("=")[1];
          }
          networksDetails.push({ id: key, model, mac, bridge, vlan });
        }
      }

      let ip_addresses: string[] = [];
      if (status === "running") {
        try {
          const agentResult = await this.request<{ result?: Array<Record<string, unknown>> }>(
            "GET",
            `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`
          );
          const ifaces = agentResult?.result ?? agentResult;
          if (Array.isArray(ifaces)) {
            for (const iface of ifaces) {
              const name = (iface.name ?? "").toString().toLowerCase();
              if (name === "lo" || name === "loopback") continue;
              const ips = (iface["ip-addresses"] ?? iface.ip_addresses) as Array<Record<string, string>>;
              if (Array.isArray(ips)) {
                for (const ipInfo of ips) {
                  const ip = (ipInfo["ip-address"] ?? ipInfo.ip_address ?? "").toString().trim();
                  if (ip && !ip.startsWith("127.") && !ip.startsWith("::1") && !ip.startsWith("fe80:") && !ip.startsWith("169.254.")) {
                    ip_addresses.push(ip);
                  }
                }
              }
            }
          }
          ip_addresses = [...new Set(ip_addresses)];
        } catch {
          // QEMU agent non disponibile
        }
      }

      vms.push({
        node,
        vmid,
        name,
        status,
        type: "qemu",
        maxcpu: effectiveCpu,
        cores,
        sockets,
        maxmem,
        memory_mb: maxmem / (1024 * 1024),
        maxdisk,
        disk_gb: bytesToGib(maxdisk),
        ip_addresses,
        disks_details: disksDetails,
        networks_details: networksDetails,
        bios: config.bios as string | undefined,
        machine: config.machine as string | undefined,
        agent: config.agent ? "1" : "0",
      });
    }

    return vms;
  }

  async getContainers(node: string, includeStopped = false): Promise<ProxmoxVM[]> {
    const lxcList = await this.request<Array<Record<string, unknown>>>("GET", `/nodes/${node}/lxc`);
    const containers: ProxmoxVM[] = [];

    for (const ct of lxcList || []) {
      const status = (ct.status ?? "unknown") as string;
      if (!includeStopped && status !== "running") continue;

      const vmid = Number(ct.vmid ?? 0);
      const name = (ct.name ?? `CT-${vmid}`) as string;
      const maxmem = Number(ct.maxmem ?? 0);
      const maxdisk = Number(ct.maxdisk ?? 0);

      let config: Record<string, unknown> = {};
      try {
        config = await this.request<Record<string, unknown>>("GET", `/nodes/${node}/lxc/${vmid}/config`);
      } catch {
        // config opzionale
      }

      const cores = Number(config.cores ?? 1);
      const maxcpu = Number(ct.maxcpu ?? cores);

      let ip_addresses: string[] = [];
      if (status === "running") {
        try {
          const agentResult = await this.request<{ result?: Array<Record<string, unknown>> }>(
            "GET",
            `/nodes/${node}/lxc/${vmid}/agent/network-get-interfaces`
          );
          const ifaces = agentResult?.result ?? agentResult;
          if (Array.isArray(ifaces)) {
            for (const iface of ifaces) {
              const ifaceName = (iface.name ?? "").toString().toLowerCase();
              if (ifaceName === "lo" || ifaceName === "loopback") continue;
              const ips = (iface["ip-addresses"] ?? iface.ip_addresses) as Array<Record<string, string>>;
              if (Array.isArray(ips)) {
                for (const ipInfo of ips) {
                  const ip = (ipInfo["ip-address"] ?? ipInfo.ip_address ?? "").toString().trim();
                  if (ip && !ip.startsWith("127.") && !ip.startsWith("::1") && !ip.startsWith("fe80:") && !ip.startsWith("169.254.")) {
                    ip_addresses.push(ip);
                  }
                }
              }
            }
          }
          ip_addresses = [...new Set(ip_addresses)];
        } catch {
          // agent non disponibile
        }
      }

      const networksDetails: ProxmoxVM["networks_details"] = [];
      for (const [key, val] of Object.entries(config)) {
        if (key.startsWith("net")) {
          const str = String(val ?? "");
          const parts = str.split(",");
          let bridge: string | undefined;
          let vlan: string | undefined;
          for (const p of parts) {
            if (p.startsWith("bridge=")) bridge = p.split("=")[1];
            if (p.startsWith("tag=")) vlan = p.split("=")[1];
          }
          networksDetails.push({ id: key, bridge, vlan });
        }
      }

      containers.push({
        node,
        vmid,
        name,
        status,
        type: "lxc",
        maxcpu,
        cores,
        sockets: 1,
        maxmem,
        memory_mb: maxmem / (1024 * 1024),
        maxdisk,
        disk_gb: bytesToGib(maxdisk),
        ip_addresses,
        disks_details: [],
        networks_details: networksDetails,
      });
    }

    return containers;
  }

  /** Estrae tutti i dati: host info per ogni nodo + VM + LXC */
  async extractAll(options?: { includeStopped?: boolean; includeContainers?: boolean }): Promise<{
    hosts: ProxmoxHostInfo[];
    vms: ProxmoxVM[];
  }> {
    await this.login();
    const nodes = await this.getNodes();
    const hosts: ProxmoxHostInfo[] = [];
    const vms: ProxmoxVM[] = [];

    for (const n of nodes) {
      const nodeName = n.node as string;
      try {
        const hostInfo = await this.getHostInfo(nodeName);
        hosts.push(hostInfo);
      } catch (e) {
        console.error(`Errore host ${nodeName}:`, e);
      }

      try {
        const nodeVms = await this.getVMs(nodeName, options?.includeStopped ?? false);
        vms.push(...nodeVms);
      } catch (e) {
        console.error(`Errore VM nodo ${nodeName}:`, e);
      }

      if (options?.includeContainers) {
        try {
          const nodeCts = await this.getContainers(nodeName, options?.includeStopped ?? false);
          vms.push(...nodeCts);
        } catch (e) {
          console.error(`Errore LXC nodo ${nodeName}:`, e);
        }
      }
    }

    return { hosts, vms };
  }
}
