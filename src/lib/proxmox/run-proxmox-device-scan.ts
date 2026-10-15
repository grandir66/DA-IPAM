import { getNetworkDeviceById, updateNetworkDevice, getDeviceCredentials, getDeviceCredentialBindings, syncInventoryFromDevice } from "@/lib/db";
import { ProxmoxClient, resolveProxmoxApiPortOverride, type ProxmoxHostInfo, type ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import { extractProxmoxViaSsh, readLiveInterfaces, type ProxmoxSshConfig } from "@/lib/proxmox/proxmox-ssh";
import { mergeProxmoxExtractResults } from "@/lib/proxmox/proxmox-merge-results";
import {
  hostIndexForTarget,
  mergeLiveIntoHost,
  previousLive,
  type LiveInterface,
} from "@/lib/proxmox/live-interfaces";
import {
  buildProxmoxApiUrlForIp,
  MAX_PROXMOX_SCAN_TARGETS,
  proxmoxSshPort,
  proxmoxSshUsername,
  resolveProxmoxTargetIps,
} from "@/lib/proxmox/proxmox-targets";
import { isProxmoxVeDevice } from "@/lib/devices/device-acquisition-resolve";

export interface ProxmoxDeviceScanResult {
  hosts: ProxmoxHostInfo[];
  vms: ProxmoxVM[];
  scanned_at: string;
  avvisi?: string[];
}

type ProxmoxExtract = { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] };

/** Bersaglio API di un nodo: URL, porta (se diversa da quella dell'URL), utente `…@pam`. */
export interface ProxmoxApiTarget {
  apiUrl: string;
  port?: number;
  username: string;
  password: string;
}

/**
 * Le tre letture di un nodo e l'orologio: in esercizio quelle vere, nelle prove
 * finte (niente rete). Le schede vive sono UN comando SSH in sola lettura.
 */
export interface ProxmoxScanDeps {
  readApi: (target: ProxmoxApiTarget) => Promise<ProxmoxExtract>;
  readSsh: (config: ProxmoxSshConfig) => Promise<ProxmoxExtract>;
  readLive: (config: ProxmoxSshConfig) => Promise<LiveInterface[]>;
  now: () => Date;
  /**
   * Credenziali al posto di quelle salvate sull'apparato: solo per la misura su
   * una copia (`scripts/misura-fase2b.ts`), dove i segreti cifrati della copia
   * non si decifrano e la password arriva da stdin.
   */
  credentials?: () => { username: string; password: string };
}

/**
 * Cosa si legge di VM e container, per l'API e per l'SSH. Anche quelli spenti (revisione finale I-2):
 * con il job giornaliero una VM spenta alle 03:00 spariva dalla mappa, i suoi MAC tornavano client della
 * porta dello switch, e «■ spenta» e «N VM, M accese» (spec §11.5) non potevano mai comparire.
 */
export const LETTURA_VM = { includeStopped: true, includeContainers: true } as const;

const DEPS_VERE: ProxmoxScanDeps = {
  readApi: (t) =>
    new ProxmoxClient({
      host: t.apiUrl,
      ...(t.port !== undefined ? { port: t.port } : {}),
      username: t.username,
      password: t.password,
      verifySsl: false,
    }).extractAll(LETTURA_VM),
  readSsh: (c) => extractProxmoxViaSsh(c, LETTURA_VM),
  readLive: (c) => readLiveInterfaces(c),
  now: () => new Date(),
};

function assertProxmoxDevice(device: import("@/types").NetworkDevice): void {
  if (!isProxmoxVeDevice(device)) {
    throw new Error(
      "Questo dispositivo non è configurato come Proxmox VE. Imposta vendor Proxmox, tipologia proxmox_ve e tipo scansione Proxmox."
    );
  }
  if (!device.enabled) {
    throw new Error("Dispositivo disabilitato");
  }
}

/** La scansione salvata l'ultima volta; null se non c'è o non si legge (mai un errore). */
function previousResult(raw: string | null | undefined): ProxmoxDeviceScanResult | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ProxmoxDeviceScanResult> | null;
    if (!v || !Array.isArray(v.hosts) || !Array.isArray(v.vms)) return null;
    return { hosts: v.hosts, vms: v.vms, scanned_at: String(v.scanned_at ?? "") };
  } catch {
    return null;
  }
}

/**
 * Esegue scan Proxmox VE (API :8006 + SSH + schede vive) e persiste il risultato
 * su network_devices.
 *
 * Review Focus 4 (piano fase 2b): una lettura fallita o incompleta non prende mai
 * il posto della precedente.
 * - Niente da API né da SSH: errore, il JSON e la data di prima restano.
 * - Zero VM con errori di lettura quando l'ultima scansione ne aveva: errore,
 *   come sopra (un «0 VM» per un nodo irraggiungibile non è un dato).
 * - Schede vive non lette su un nodo: la scansione si salva, ma su quell'host
 *   restano le schede vive di prima con la loro `live_read_at`; l'errore va negli
 *   `avvisi`. Un host del cluster che non si sa riconoscere non riceve schede vive.
 * Gli errori (che possono contenere indirizzi) tornano a chi chiama: qui non si
 * scrive niente nel log.
 */
export async function runProxmoxDeviceScan(
  deviceId: number,
  deps: Partial<ProxmoxScanDeps> = {},
): Promise<ProxmoxDeviceScanResult> {
  const io: ProxmoxScanDeps = { ...DEPS_VERE, ...deps };
  const device = getNetworkDeviceById(deviceId);
  if (!device) {
    throw new Error("Dispositivo non trovato");
  }

  assertProxmoxDevice(device);

  const creds = io.credentials ? io.credentials() : getDeviceCredentials(device);
  if (!creds) {
    throw new Error("Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password.");
  }
  const { username, password } = creds;

  const targets = resolveProxmoxTargetIps(device);
  if (targets.length === 0) {
    throw new Error("Indica un host o IP valido (es. 192.168.40.1 o 192.168.40.1,2,3).");
  }
  if (targets.length > MAX_PROXMOX_SCAN_TARGETS) {
    throw new Error(`Troppi indirizzi (${targets.length}). Massimo ${MAX_PROXMOX_SCAN_TARGETS}.`);
  }

  const apiUsername = username.includes("@") ? username : `${username}@pam`;
  const sshUsername = proxmoxSshUsername(username);
  // `device.port` è la porta dell'API (443/8006): l'SSH va sulla porta della credenziale SSH, o 22.
  const sshPort = proxmoxSshPort(getDeviceCredentialBindings(device.id));

  const chunks: ProxmoxExtract[] = [];
  const partialErrors: string[] = [];
  const liveByTarget: Array<{ ip: string; live: LiveInterface[] }> = [];
  const liveErrors: string[] = [];

  for (const ip of targets) {
    const apiUrl = buildProxmoxApiUrlForIp(ip, device.api_url);
    try {
      const port = resolveProxmoxApiPortOverride(apiUrl, device.port ?? undefined);
      chunks.push(await io.readApi({ apiUrl, ...(port !== undefined ? { port } : {}), username: apiUsername, password }));
    } catch (e) {
      partialErrors.push(`API ${ip}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const ssh: ProxmoxSshConfig = { host: ip, port: sshPort, username: sshUsername, password };
    try {
      chunks.push(await io.readSsh(ssh));
    } catch (e) {
      partialErrors.push(`SSH ${ip}: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      liveByTarget.push({ ip, live: await io.readLive(ssh) });
    } catch (e) {
      liveErrors.push(`Schede vive ${ip}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const merged = mergeProxmoxExtractResults(chunks);
  if (merged.hosts.length === 0 && merged.vms.length === 0) {
    throw new Error(
      partialErrors.length > 0
        ? partialErrors.join(" | ")
        : "Nessun dato raccolto da API o SSH sui target indicati."
    );
  }

  const previous = previousResult(device.last_proxmox_scan_result);
  if (merged.vms.length === 0 && partialErrors.length > 0 && (previous?.vms.length ?? 0) > 0) {
    throw new Error(
      `Lettura incompleta: nessuna VM letta e ${partialErrors.length} errori; resta la scansione precedente. ` +
        partialErrors.join(" | "),
    );
  }

  const scannedAt = io.now().toISOString();
  const hosts = [...merged.hosts];
  const liveHosts = new Set<number>();
  for (const { ip, live } of liveByTarget) {
    const idx = hostIndexForTarget(hosts, ip, previous?.hosts ?? []);
    if (idx < 0) {
      liveErrors.push(`Schede vive ${ip}: non si sa a quale host del cluster appartengono, non usate`);
      continue;
    }
    hosts[idx] = mergeLiveIntoHost(hosts[idx], live, scannedAt);
    liveHosts.add(idx);
  }
  // Dove le schede vive non sono state lette adesso restano quelle di prima, con la loro data.
  for (let i = 0; i < hosts.length; i++) {
    if (liveHosts.has(i)) continue;
    const prima = previousLive(previous?.hosts.find((h) => h.hostname === hosts[i].hostname));
    if (prima) hosts[i] = mergeLiveIntoHost(hosts[i], prima.live, prima.readAt);
  }

  const avvisi = [...partialErrors, ...liveErrors];
  const result: ProxmoxDeviceScanResult = {
    hosts,
    vms: merged.vms,
    scanned_at: scannedAt,
    ...(avvisi.length > 0 ? { avvisi } : {}),
  };

  const updatedDevice = {
    ...device,
    last_proxmox_scan_at: result.scanned_at,
    last_proxmox_scan_result: JSON.stringify(result),
  };
  updateNetworkDevice(deviceId, {
    last_proxmox_scan_at: result.scanned_at,
    last_proxmox_scan_result: JSON.stringify(result),
  });
  syncInventoryFromDevice(updatedDevice as typeof device & { last_proxmox_scan_result: string });

  return result;
}
