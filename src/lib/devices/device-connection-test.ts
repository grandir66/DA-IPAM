import { getCredentialById, getDeviceCredentials, getCredentialCommunityString } from "@/lib/db";
import { decrypt, safeDecrypt } from "@/lib/crypto";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { createWinrmClient } from "@/lib/devices/winrm-client";
import { sshExec } from "@/lib/devices/ssh-helper";
import { ProxmoxClient, resolveProxmoxApiPortOverride } from "@/lib/proxmox/proxmox-client";
import { testProxmoxSsh } from "@/lib/proxmox/proxmox-ssh";
import {
  buildProxmoxApiUrlForIp,
  MAX_PROXMOX_SCAN_TARGETS,
  proxmoxSshUsername,
  resolveProxmoxTargetIps,
} from "@/lib/proxmox/proxmox-targets";
import type { NetworkDevice } from "@/types";
import {
  getDefaultProductProfileForVendor,
  scanTargetHintFromProductProfile,
  suggestDeviceTypeFromProductProfile,
  vendorSubtypeFromProductProfile,
  type ProductProfileId,
} from "@/lib/device-product-profiles";

export interface DeviceTestResult {
  success: boolean;
  device_type?: string;
  error?: string;
  message?: string;
  proxmox_api_ok?: boolean;
  proxmox_ssh_ok?: boolean;
  proxmox_targets?: { ip: string; api: boolean; ssh: boolean }[];
}

export function isProxmoxDevice(device: { device_type?: string; protocol?: string; scan_target?: string | null; vendor?: string }): boolean {
  const scanTarget = device.scan_target;
  if (scanTarget === "windows" || scanTarget === "vmware" || scanTarget === "linux") return false;
  return scanTarget === "proxmox" || device.device_type === "hypervisor" || device.vendor === "proxmox";
}

export function isWindowsDevice(device: { vendor?: string; protocol?: string; scan_target?: string | null }): boolean {
  if (device.scan_target === "windows") return true;
  return device.protocol === "winrm" || device.vendor === "windows";
}

export function isSshScannableDevice(device: { vendor?: string; protocol?: string; scan_target?: string | null }): boolean {
  if (device.scan_target === "linux") return true;
  return device.protocol === "ssh" && (device.vendor === "linux" || device.vendor === "other" || device.vendor === "synology" || device.vendor === "qnap");
}

export interface ProvisionalDevice {
  host: string;
  vendor: string;
  protocol: string;
  port?: number;
  credential_id?: number | null;
  snmp_credential_id?: number | null;
  scan_target?: string | null;
  api_url?: string | null;
  /** Profilo prodotto (marca + tipologia); per test coerente con device_type e vendor_subtype */
  product_profile?: string | null;
  device_type?: string;
  username?: string | null;
  encrypted_password?: string | null;
  community_string?: string | null;
}

function buildDeviceFromProvisional(p: ProvisionalDevice): NetworkDevice {
  const profileId = (p.product_profile ?? getDefaultProductProfileForVendor(p.vendor)) as ProductProfileId;
  const fromProfile = suggestDeviceTypeFromProductProfile(profileId);
  const effectiveScan =
    (p.scan_target ?? scanTargetHintFromProductProfile(profileId)) as NetworkDevice["scan_target"] | null;
  const deviceType: "router" | "switch" | "hypervisor" =
    isProxmoxDevice({
      ...p,
      device_type: fromProfile,
      scan_target: effectiveScan,
      vendor: p.vendor,
    } as Parameters<typeof isProxmoxDevice>[0])
      ? "hypervisor"
      : fromProfile;

  return {
    id: 0,
    name: p.host,
    host: p.host,
    device_type: deviceType,
    classification: null,
    vendor: p.vendor as NetworkDevice["vendor"],
    vendor_subtype: vendorSubtypeFromProductProfile(profileId),
    protocol: p.protocol as NetworkDevice["protocol"],
    credential_id: p.credential_id ?? null,
    snmp_credential_id: p.snmp_credential_id ?? null,
    username: p.username ?? null,
    encrypted_password: p.encrypted_password ?? null,
    community_string: p.community_string ?? null,
    api_token: null,
    api_url: p.api_url ?? null,
    port: p.port ?? (p.protocol === "ssh" ? 22 : p.protocol === "winrm" ? 5985 : p.protocol === "api" ? 443 : 161),
    enabled: 1,
    sysname: null,
    sysdescr: null,
    model: null,
    firmware: null,
    serial_number: null,
    part_number: null,
    last_info_update: null,
    last_device_info_json: null,
    stp_info: null,
    last_proxmox_scan_at: null,
    last_proxmox_scan_result: null,
    scan_target: effectiveScan,
    product_profile: profileId,
    created_at: "",
    updated_at: "",
  };
}

function resolveCredentials(device: NetworkDevice): { username: string; password: string } | null {
  // Prima: sistema bindings v2 (cerca in device_credential_bindings + fallback legacy)
  const creds = getDeviceCredentials(device);
  if (creds?.username && creds?.password) return creds;
  return null;
}

export async function runDeviceConnectionTest(device: NetworkDevice, timeoutMs?: number): Promise<DeviceTestResult> {
  const effectiveTimeout = timeoutMs ?? (isProxmoxDevice(device) ? Math.min(180_000, 15_000 + resolveProxmoxTargetIps(device).length * 25_000) : 15_000);

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timeout: il dispositivo non ha risposto entro ${Math.round(effectiveTimeout / 1000)} secondi`)),
      effectiveTimeout
    )
  );

  const testPromise = (async (): Promise<DeviceTestResult> => {
    if (isProxmoxDevice(device)) {
      const creds = resolveCredentials(device);
      if (!creds?.password) {
        throw new Error("Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password.");
      }
      const { username, password } = creds;
      const targets = resolveProxmoxTargetIps(device);
      if (targets.length === 0) {
        throw new Error("Indica un host o IP valido (es. 192.168.40.1 o 192.168.40.1,2,3).");
      }
      if (targets.length > MAX_PROXMOX_SCAN_TARGETS) {
        throw new Error(`Troppi indirizzi (max ${MAX_PROXMOX_SCAN_TARGETS}).`);
      }

      const apiUsername = username.includes("@") ? username : `${username}@pam`;
      const sshUsername = proxmoxSshUsername(username);

      let anyApi = false;
      let anySsh = false;
      const proxmox_targets: { ip: string; api: boolean; ssh: boolean }[] = [];

      for (const ip of targets) {
        const apiUrl = buildProxmoxApiUrlForIp(ip, device.api_url ?? undefined);
        let apiOk = false;
        try {
          const apiPort = resolveProxmoxApiPortOverride(apiUrl, device.port ?? undefined);
          const client = new ProxmoxClient({
            host: apiUrl,
            ...(apiPort !== undefined ? { port: apiPort } : {}),
            username: apiUsername,
            password,
            verifySsl: false,
          });
          await client.login();
          apiOk = true;
          anyApi = true;
        } catch {
          /* tentativo API su questo IP fallito */
        }
        let sshOk = false;
        try {
          sshOk = await testProxmoxSsh({
            host: ip,
            port: device.port ?? 22,
            username: sshUsername,
            password,
          });
          if (sshOk) anySsh = true;
        } catch {
          /* SSH fallita su questo IP */
        }
        proxmox_targets.push({ ip, api: apiOk, ssh: sshOk });
      }

      return {
        success: anyApi || anySsh,
        device_type: "hypervisor",
        proxmox_api_ok: anyApi,
        proxmox_ssh_ok: anySsh,
        proxmox_targets,
        message: anyApi && anySsh
          ? `Connessione OK (API + SSH)`
          : anyApi
          ? `Connessione OK (solo API)`
          : anySsh
          ? `Connessione OK (solo SSH)`
          : undefined,
      };
    }

    if (device.device_type === "router") {
      const client = await createRouterClient(device);
      const ok = await client.testConnection();
      return { success: ok, device_type: "router", message: ok ? "Connessione OK (router)" : undefined };
    }

    if (isWindowsDevice(device)) {
      const client = await createWinrmClient(device);
      const ok = await client.testConnection();
      return { success: ok, device_type: "windows", message: ok ? "Connessione WinRM OK" : undefined };
    }

    if (isSshScannableDevice(device)) {
      const creds = resolveCredentials(device);
      if (!creds?.username || !creds?.password) {
        throw new Error("Credenziali mancanti. Assegna una credenziale di tipo Linux (SSH) al dispositivo.");
      }
      const host = device.host.replace(/^https?:\/\//i, "").split(":")[0];
      const res = await sshExec(
        { host, port: device.port ?? 22, username: creds.username, password: creds.password, timeout: 15000 },
        "hostname 2>/dev/null || echo ok"
      );
      const dtype = device.vendor === "synology" || device.vendor === "qnap" ? "storage" : "linux";
      return { success: res.code === 0, device_type: dtype, message: res.code === 0 ? `Connessione SSH OK` : undefined };
    }

    const client = await createSwitchClient(device);
    const ok = await client.testConnection();
    return { success: ok, device_type: "switch", message: ok ? "Connessione OK (switch)" : undefined };
  })();

  return Promise.race([testPromise, timeoutPromise]);
}

export async function runProvisionalDeviceTest(provisional: ProvisionalDevice): Promise<DeviceTestResult> {
  const device = buildDeviceFromProvisional(provisional);
  return runDeviceConnectionTest(device);
}

export function getWindowsHint(errorMessage: string): string {
  if (errorMessage.includes("pywinrm") || errorMessage.includes("Modulo Python")) {
    return " Sul server Linux che ospita DA-INVENT installa pywinrm: ~/.da-invent-venv/bin/pip install pywinrm requests-ntlm requests-credssp oppure esegui scripts/install.sh come root (crea il venv). Opzioni: WINRM_PYTHON, WINRM_TRANSPORT (ntlm/credssp) in .env.local.";
  }
  if (
    errorMessage.includes("NTLM") ||
    errorMessage.includes("401") ||
    errorMessage.toLowerCase().includes("credentials were rejected")
  ) {
    return " Su Windows: winrm set winrm/config/service/Auth '@{Basic=\"true\"}' e verifica che WinRM sia attivo. Per AD usa DOMINIO\\utente o utente@dominio.";
  }
  if (errorMessage.includes("Credenziali mancanti")) {
    return " Assegna una credenziale di tipo Windows al dispositivo.";
  }
  if (errorMessage.includes("Connessione rifiutata") || errorMessage.includes("ECONNREFUSED")) {
    return " Su Windows: winrm quickconfig e firewall in ingresso verso questo server (5985/5986). DA-INVENT usa solo WinRM, non WMI su RPC.";
  }
  return "";
}
