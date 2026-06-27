import crypto from "node:crypto";

/**
 * Client REST per Headwind MDM (hmdm-server). Contratto verificato a runtime su hmdm 0.1.8:
 * docs/integrations/hmdm/hmdm-rest-contract.md.
 *
 * Gotcha verificati:
 *  - login: campo `password` = MD5(plaintext) hex UPPERCASE (la web UI fa md5().toUpperCase());
 *    server verifica SHA1(md5_upper + salt) case-insensitive. Plaintext o md5 lowercase → 401.
 *  - token: in `id_token`.
 *  - device search: `pageNum` 1-based (0 → 500 OFFSET error).
 *  - `model` + lista app completa solo dal plugin deviceinfo (DeviceInfoView).
 */

export type HmdmCreds = { baseUrl: string; username: string; password: string };

export interface DeviceView {
  number: string;
  serial: string | null;
  imei: string | null;
  phone: string | null;
  androidVersion: string | null;
  description: string | null;
  custom1: string | null;
  custom2: string | null;
  custom3: string | null;
  lastUpdate: number | null;
  enrollTime: number | null;
  info: string | null;
  statusCode: string | null;
}

export interface DeviceInfoApplication {
  applicationName: string | null;
  applicationPkg: string;
  versionInstalled: string | null;
}

export interface DeviceInfoView {
  model: string | null;
  serial: string | null;
  imei: string | null;
  androidVersion: string | null;
  batteryLevel: number | null;
  cpu: string | null;
  applications: DeviceInfoApplication[];
}

function base(u: string): string {
  return u.replace(/\/+$/, "");
}

function md5hexUpper(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex").toUpperCase();
}

export async function loginJwt(c: HmdmCreds): Promise<string> {
  const res = await fetch(`${base(c.baseUrl)}/rest/public/jwt/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: c.username, password: md5hexUpper(c.password) }),
  });
  if (!res.ok) throw new Error(`hmdm login failed: ${res.status}`);
  const j = (await res.json()) as { id_token?: string; data?: { id_token?: string } };
  const token = j?.id_token ?? j?.data?.id_token;
  if (!token) throw new Error("hmdm login: no id_token in response");
  return token;
}

export function parseDeviceSearchResponse(raw: unknown): DeviceView[] {
  const r = raw as { data?: { devices?: { items?: unknown[] }; items?: unknown[] } };
  const items = (r?.data?.devices?.items ?? r?.data?.items ?? []) as Record<string, unknown>[];
  return items.map((d) => ({
    number: String(d.number ?? ""),
    serial: (d.serial as string) ?? null,
    imei: (d.imei as string) ?? null,
    phone: (d.phone as string) ?? null,
    androidVersion: (d.androidVersion as string) ?? null,
    description: (d.description as string) ?? null,
    custom1: (d.custom1 as string) ?? null,
    custom2: (d.custom2 as string) ?? null,
    custom3: (d.custom3 as string) ?? null,
    lastUpdate: (d.lastUpdate as number) ?? null,
    enrollTime: (d.enrollTime as number) ?? null,
    info: (d.info as string) ?? null,
    statusCode: (d.statusCode as string) ?? null,
  }));
}

export function parseDeviceInfoResponse(raw: unknown): DeviceInfoView | null {
  const d = (raw as { data?: Record<string, unknown> })?.data;
  if (!d) return null;
  const apps = (d.applications as Record<string, unknown>[] | undefined) ?? [];
  return {
    model: (d.model as string) ?? null,
    serial: (d.serial as string) ?? null,
    imei: (d.imei as string) ?? null,
    androidVersion: (d.androidVersion as string) ?? null,
    batteryLevel: (d.batteryLevel as number) ?? null,
    cpu: (d.cpu as string) ?? null,
    applications: apps
      .map((a) => ({
        applicationName: (a.applicationName as string) ?? null,
        applicationPkg: String(a.applicationPkg ?? ""),
        versionInstalled: (a.versionInstalled as string) ?? null,
      }))
      .filter((a) => a.applicationPkg),
  };
}

export async function searchDevices(
  baseUrl: string,
  jwt: string,
  pageNum: number,
  pageSize: number,
): Promise<DeviceView[]> {
  // pageNum 1-based (0 → 500 OFFSET must not be negative)
  const res = await fetch(`${base(baseUrl)}/rest/private/devices/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pageNum, pageSize, sortBy: "number", sortDir: "ASC", value: "" }),
  });
  if (!res.ok) throw new Error(`hmdm device search failed: ${res.status}`);
  return parseDeviceSearchResponse(await res.json());
}

export async function getDeviceInfo(
  baseUrl: string,
  jwt: string,
  deviceNumber: string,
): Promise<DeviceInfoView | null> {
  const res = await fetch(
    `${base(baseUrl)}/rest/plugins/deviceinfo/deviceinfo/private/${encodeURIComponent(deviceNumber)}`,
    { headers: { authorization: `Bearer ${jwt}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`hmdm deviceinfo failed: ${res.status}`);
  return parseDeviceInfoResponse(await res.json());
}
