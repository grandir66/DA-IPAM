/**
 * Un solo punto che scrive la classificazione, nei due versi (tappa 5, 21/10):
 * dall'apparato all'host e dall'host all'apparato. Le rotte delle scelte
 * dell'utente passano di qui; le scritture automatiche (scansione, attribuzione)
 * restano dove sono e rispettano `classification_manual`.
 *
 * Abbinamento apparato <-> host: come fa il resto del codice, prima la chiave
 * `network_devices.host_id`, poi l'IP (`network_devices.host` = `hosts.ip`).
 * Con più host sullo stesso IP (reti diverse) vale il primo; se l'apparato ha
 * `host_id` si usa quello.
 *
 * Riceve l'handle del database (come `scrittura.ts`): niente import di db.
 */
import type Database from "better-sqlite3";
import { canonicalizza, unisciRuoli, type RuoloServer } from "./canonico";
import { aggiungiRuoloServer, impostaVendorSeVuoto } from "./scrittura";
import { resolveDeviceTypeForCreate, type ProductProfileId } from "@/lib/device-product-profiles";
import type { NetworkDevice } from "@/types";

export interface Bersaglio {
  hostId?: number;
  deviceId?: number;
}

interface Abbinati {
  hostId: number | null;
  deviceId: number | null;
}

/** Trova l'altro lato (o i due lati) a partire da quello dato. */
function abbina(db: Database.Database, b: Bersaglio): Abbinati {
  if (b.deviceId != null) {
    const d = db.prepare("SELECT id, host, host_id FROM network_devices WHERE id = ?").get(b.deviceId) as
      | { id: number; host: string; host_id: number | null }
      | undefined;
    if (!d) return { hostId: null, deviceId: null };
    let h: { id: number } | undefined;
    if (d.host_id != null) h = db.prepare("SELECT id FROM hosts WHERE id = ?").get(d.host_id) as { id: number } | undefined;
    if (!h) h = db.prepare("SELECT id FROM hosts WHERE ip = ? ORDER BY id LIMIT 1").get(d.host) as { id: number } | undefined;
    return { hostId: h?.id ?? null, deviceId: d.id };
  }
  if (b.hostId != null) {
    const h = db.prepare("SELECT id, ip FROM hosts WHERE id = ?").get(b.hostId) as { id: number; ip: string } | undefined;
    if (!h) return { hostId: null, deviceId: null };
    const d =
      (db.prepare("SELECT id FROM network_devices WHERE host_id = ? ORDER BY id LIMIT 1").get(h.id) as { id: number } | undefined) ??
      (db.prepare("SELECT id FROM network_devices WHERE host = ? ORDER BY id LIMIT 1").get(h.ip) as { id: number } | undefined);
    return { hostId: h.id, deviceId: d?.id ?? null };
  }
  return { hostId: null, deviceId: null };
}

/**
 * Scrive `valore` (canonicalizzato) su host e apparato abbinati. `manuale = true`
 * (scelta dell'utente) mette `classification_manual = 1` su entrambi; `false`
 * scrive il valore senza fissarlo. `ruoli` (solo per i server) entrano in
 * `server_roles` di entrambi, insieme al ruolo che il valore stesso porta.
 * Il `device_type` dell'apparato si ricalcola dalla classificazione.
 */
export function scriviClassificazione(
  db: Database.Database,
  b: Bersaglio,
  valore: string,
  opts: { manuale: boolean; ruoli?: RuoloServer[] | null },
): { hostId: number | null; deviceId: number | null } {
  const { hostId, deviceId } = abbina(db, b);
  const c = canonicalizza(valore);
  const manuale = opts.manuale ? 1 : null;

  db.transaction(() => {
    if (hostId != null) {
      db.prepare(
        `UPDATE hosts SET classification = ?, classification_manual = COALESCE(?, classification_manual), updated_at = datetime('now') WHERE id = ?`,
      ).run(c.classificazione, manuale, hostId);
      aggiungiRuoloServer(db, "hosts", hostId, c);
    }
    if (deviceId != null) {
      const d = db.prepare("SELECT device_type, product_profile FROM network_devices WHERE id = ?").get(deviceId) as {
        device_type: NetworkDevice["device_type"];
        product_profile: string | null;
      };
      const deviceType = resolveDeviceTypeForCreate({
        product_profile: (d.product_profile ?? "generic") as ProductProfileId,
        device_type: d.device_type,
        classification: c.classificazione,
      });
      db.prepare(
        `UPDATE network_devices SET classification = ?, device_type = ?, classification_manual = COALESCE(?, classification_manual), updated_at = datetime('now') WHERE id = ?`,
      ).run(c.classificazione, deviceType, manuale, deviceId);
      aggiungiRuoloServer(db, "network_devices", deviceId, c);
      impostaVendorSeVuoto(db, deviceId, c);
    }
    for (const ruolo of opts.ruoli ?? []) {
      for (const [tab, id] of [["hosts", hostId], ["network_devices", deviceId]] as const) {
        if (id == null) continue;
        const r = db.prepare(`SELECT server_roles FROM ${tab} WHERE id = ?`).get(id) as { server_roles: string | null };
        const nuovo = unisciRuoli(r.server_roles, ruolo);
        if (nuovo !== r.server_roles) db.prepare(`UPDATE ${tab} SET server_roles = ? WHERE id = ?`).run(nuovo, id);
      }
    }
  })();

  return { hostId, deviceId };
}

/** «Torna automatica»: `classification_manual = 0` su host e apparato abbinati. Il valore resta, la prossima scansione può cambiarlo. */
export function tornaAutomatica(db: Database.Database, b: Bersaglio): void {
  const { hostId, deviceId } = abbina(db, b);
  db.transaction(() => {
    if (hostId != null) db.prepare("UPDATE hosts SET classification_manual = 0 WHERE id = ?").run(hostId);
    if (deviceId != null) db.prepare("UPDATE network_devices SET classification_manual = 0 WHERE id = ?").run(deviceId);
  })();
}
