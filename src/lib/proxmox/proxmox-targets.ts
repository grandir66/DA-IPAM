import { expandIpv4CommaShorthand } from "@/lib/utils";
import { parseProxmoxUrl } from "./proxmox-client";

export const MAX_PROXMOX_SCAN_TARGETS = 32;

/** Utente Linux/SSH: rimuove realm Proxmox (@pam, @pve, …). */
export function proxmoxSshUsername(apiStyleUser: string): string {
  const i = apiStyleUser.indexOf("@");
  return i > 0 ? apiStyleUser.slice(0, i) : apiStyleUser;
}

/**
 * Porta SSH di un hypervisor (lettura via SSH e schede vive): quella della credenziale SSH legata all'apparato
 * (`device_credential_bindings.port`; prima quella provata con successo, poi l'ordine delle credenziali), altrimenti 22.
 * Mai `network_devices.port`: per un Proxmox è la porta dell'API (443/8006) e l'SSH lì viene rifiutato.
 */
export function proxmoxSshPort(
  bindings: ReadonlyArray<{ protocol_type: string; port: number | null; test_status?: string | null }>,
): number {
  const valida = (p: number | null): p is number => typeof p === "number" && Number.isInteger(p) && p > 0 && p <= 65535;
  const ssh = bindings.filter((b) => b.protocol_type === "ssh" && valida(b.port));
  return (ssh.find((b) => b.test_status === "success") ?? ssh[0])?.port ?? 22;
}

export function buildProxmoxApiUrlForIp(ip: string, templateUrl: string | null | undefined): string {
  const t = templateUrl?.trim();
  if (!t) return `https://${ip}:8006`;
  const { port, useHttps } = parseProxmoxUrl(t);
  const proto = useHttps ? "https" : "http";
  return `${proto}://${ip}:${port}`;
}

/**
 * Elenco IP/host da contattare: campo Host `192.168.40.1,2,3` oppure stessa notazione nell'host estratto da URL API.
 */
export function resolveProxmoxTargetIps(device: { host: string; api_url?: string | null }): string[] {
  const h = device.host?.trim() ?? "";
  if (h.includes(",")) {
    return expandIpv4CommaShorthand(h);
  }
  const api = device.api_url?.trim();
  if (api) {
    const { host: apiHost } = parseProxmoxUrl(api);
    if (apiHost.includes(",")) {
      return expandIpv4CommaShorthand(apiHost);
    }
  }
  const single = h || (api ? parseProxmoxUrl(api).host : "");
  return single ? [single] : [];
}
