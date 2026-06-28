import crypto from "node:crypto";
import { getTenantDb, getCurrentTenantCode, upsertHost } from "@/lib/db-tenant";
import { getMdmConfig } from "@/lib/integrations/mdm-config";
import type { DeviceView, DeviceInfoView } from "@/lib/integrations/hmdm-client";

/**
 * Mapper Headwind → DA-IPAM. I mobili confluiscono in `hosts` come first-class su una
 * rete sintetica "Mobile (MDM)" (CIDR sentinella TEST-NET, mai instradata), con
 * pseudo-IP = device `number` (stabile/unico; il serial può essere null sui device
 * non-Device-Owner). Dedup per snapshot, diff append-only in mobile_inventory_history.
 */

const MOBILE_NET_CIDR = "192.0.2.0/32"; // RFC5737 TEST-NET-1, non instradato
const MOBILE_NET_NAME = "Mobile (MDM)";

function db() {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("mdm-sync: no tenant context");
  return getTenantDb(c);
}

function isoFromMillis(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function pickUser(dv: DeviceView, field: string): string | null {
  const map: Record<string, string | null> = {
    description: dv.description,
    custom1: dv.custom1,
    custom2: dv.custom2,
    custom3: dv.custom3,
  };
  return map[field] ?? dv.description ?? null;
}

/** Rete sintetica che ospita i mobili. Idempotente. */
export function getOrCreateMobileNetwork(): number {
  const conn = db();
  const existing = conn.prepare(`SELECT id FROM networks WHERE cidr=?`).get(MOBILE_NET_CIDR) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const r = conn
    .prepare(`INSERT INTO networks (cidr, name, description) VALUES (?, ?, ?)`)
    .run(MOBILE_NET_CIDR, MOBILE_NET_NAME, "Device mobili gestiti via MDM (Headwind)");
  return Number(r.lastInsertRowid);
}

export interface ApplyResult {
  deviceId: number;
  deduped: boolean;
  changes: number;
  hostId: number | null;
}

export function applyDevice(dv: DeviceView, di: DeviceInfoView | null): ApplyResult {
  const conn = db();
  const cfg = getMdmConfig();
  const model = di?.model ?? null;
  const apps = di?.applications ?? [];
  const user = pickUser(dv, cfg.user_field);

  const snapshot = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        serial: dv.serial,
        model,
        os: dv.androidVersion,
        user,
        imei: dv.imei,
        apps: apps.map((a) => `${a.applicationPkg}@${a.versionInstalled}`).sort(),
      }),
    )
    .digest("hex");

  const tx = conn.transaction((): ApplyResult => {
    let dev = conn
      .prepare(`SELECT id, host_id FROM mobile_devices WHERE hmdm_device_id=?`)
      .get(dv.number) as { id: number; host_id: number | null } | undefined;
    if (!dev) {
      const r = conn
        .prepare(`INSERT INTO mobile_devices (hmdm_device_id, label, created_at) VALUES (?,?,datetime('now'))`)
        .run(dv.number, model ?? dv.number);
      dev = { id: Number(r.lastInsertRowid), host_id: null };
    }
    const deviceId = dev.id;
    const prev = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE device_id=?`).get(deviceId) as
      | Record<string, unknown>
      | undefined;

    if (prev && prev.snapshot_sha256 === snapshot) {
      conn
        .prepare(`UPDATE mobile_devices SET last_seen_at=?, last_sync_at=datetime('now') WHERE id=?`)
        .run(isoFromMillis(dv.lastUpdate), deviceId);
      return { deviceId, deduped: true, changes: 0, hostId: dev.host_id };
    }

    let changes = 0;
    const log = (type: string, field: string | null, o: unknown, n: unknown) => {
      conn
        .prepare(
          `INSERT INTO mobile_inventory_history (device_id, change_type, field, old_value, new_value) VALUES (?,?,?,?,?)`,
        )
        .run(deviceId, type, field, o == null ? null : String(o), n == null ? null : String(n));
      changes++;
    };

    if (prev) {
      if ((prev.os_version ?? null) !== (dv.androidVersion ?? null))
        log("os_update", "os_version", prev.os_version, dv.androidVersion);
      if ((prev.user_profile ?? null) !== (user ?? null)) log("user_change", "user_profile", prev.user_profile, user);
      if ((prev.model ?? null) !== (model ?? null)) log("field_change", "model", prev.model, model);
      if ((prev.serial ?? null) !== (dv.serial ?? null)) log("field_change", "serial", prev.serial, dv.serial);
    }

    conn
      .prepare(
        `INSERT INTO mobile_device_inventory
           (device_id, serial, model, os_family, os_version, user_profile, imei, imei2, phone, cpu, battery_level, snapshot_sha256, last_inventory_at)
         VALUES (@device_id,@serial,@model,'android',@os,@user,@imei,NULL,@phone,@cpu,@batt,@snap, datetime('now'))
         ON CONFLICT(device_id) DO UPDATE SET serial=@serial, model=@model, os_family='android', os_version=@os,
           user_profile=@user, imei=@imei, phone=@phone, cpu=@cpu, battery_level=@batt,
           snapshot_sha256=@snap, last_inventory_at=datetime('now')`,
      )
      .run({
        device_id: deviceId,
        serial: dv.serial,
        model,
        os: dv.androidVersion,
        user,
        imei: dv.imei,
        phone: dv.phone,
        cpu: di?.cpu ?? null,
        batt: di?.batteryLevel ?? null,
        snap: snapshot,
      });

    // apps diff
    const prevApps = conn
      .prepare(`SELECT package_name FROM mobile_device_apps WHERE device_id=?`)
      .all(deviceId) as Array<{ package_name: string }>;
    const prevSet = new Set(prevApps.map((a) => a.package_name));
    const nextSet = new Set(apps.map((a) => a.applicationPkg));
    for (const a of apps) {
      conn
        .prepare(
          `INSERT INTO mobile_device_apps (device_id, package_name, app_name, version_name, first_seen, last_seen)
           VALUES (?,?,?,?, datetime('now'), datetime('now'))
           ON CONFLICT(device_id, package_name) DO UPDATE SET app_name=excluded.app_name,
             version_name=excluded.version_name, last_seen=datetime('now')`,
        )
        .run(deviceId, a.applicationPkg, a.applicationName, a.versionInstalled);
      if (!prevSet.has(a.applicationPkg)) log("app_added", a.applicationPkg, null, a.versionInstalled);
    }
    for (const a of prevApps) {
      if (!nextSet.has(a.package_name)) {
        conn.prepare(`DELETE FROM mobile_device_apps WHERE device_id=? AND package_name=?`).run(deviceId, a.package_name);
        log("app_removed", a.package_name, null, null);
      }
    }

    // host first-class: rete sintetica, pseudo-IP = device number
    const netId = getOrCreateMobileNetwork();
    const host = upsertHost({
      network_id: netId,
      ip: dv.number,
      hostname: model ?? dv.number,
      hostname_source: "mdm",
      classification: "smartphone",
      os_info: `Android ${dv.androidVersion ?? ""}`.trim(),
      serial_number: dv.serial ?? undefined,
      model: model ?? undefined,
      status: "online",
      preserve_existing: true,
    });
    let hostId = dev.host_id;
    if (host) {
      hostId = host.id;
      conn.prepare(`UPDATE hosts SET host_source='mdm' WHERE id=?`).run(hostId);
    }
    conn
      .prepare(`UPDATE mobile_devices SET host_id=?, last_seen_at=?, last_sync_at=datetime('now') WHERE id=?`)
      .run(hostId, isoFromMillis(dv.lastUpdate), deviceId);

    return { deviceId, deduped: false, changes, hostId };
  });

  return tx();
}

export function getMobileDetailByHost(hostId: number) {
  const conn = db();
  const device = conn
    .prepare(`SELECT * FROM mobile_devices WHERE host_id=? ORDER BY id DESC LIMIT 1`)
    .get(hostId) as { id: number } | undefined;
  if (!device) return null;
  const inventory = conn.prepare(`SELECT * FROM mobile_device_inventory WHERE device_id=?`).get(device.id);
  const apps = conn.prepare(`SELECT * FROM mobile_device_apps WHERE device_id=? ORDER BY app_name`).all(device.id);
  const history = conn
    .prepare(`SELECT * FROM mobile_inventory_history WHERE device_id=? ORDER BY changed_at DESC, id DESC LIMIT 500`)
    .all(device.id);
  return { device, inventory, apps, history };
}
