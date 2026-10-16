import { expandIpv4CommaShorthand } from "@/lib/utils";
import { parseProxmoxUrl } from "./proxmox-client";

export const MAX_PROXMOX_SCAN_TARGETS = 32;

/** Utente Linux/SSH: rimuove realm Proxmox (@pam, @pve, …). */
export function proxmoxSshUsername(apiStyleUser: string): string {
  const i = apiStyleUser.indexOf("@");
  return i > 0 ? apiStyleUser.slice(0, i) : apiStyleUser;
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
