/**
 * Conversione una tantum di `network_devices.device_type` (21/10, scheda per tipo).
 * `switch` era il workaround di schema per server, NAS e firewall: le righe con
 * device_type='switch' ma classificazione diversa da switch si ricalcolano con
 * `resolveDeviceTypeForCreate`. Non tocca `classification`.
 *
 * Il segno `device_type_v21` in `tenant_settings` (`done:<data>:convertiti=N`) chiude la
 * conversione, come `classificazioni_v21`. L'elenco per nome (id, nome, da -> a) va nel log
 * PRIMA di scrivere. Modulo puro: riceve l'handle, non importa db.ts né db-tenant.ts.
 */
import type Database from "better-sqlite3";
import { resolveDeviceTypeForCreate, type ProductProfileId } from "@/lib/device-product-profiles";
import { conversioneChiusa, leggiSegno, scriviSegno } from "@/lib/credentials/segni-t2";

export const SEGNO_DEVICE_TYPE_V21 = "device_type_v21";

export interface EsitoDeviceTypeV21 {
  eseguita: boolean;
  convertiti: number;
}

interface Riga {
  id: number;
  name: string;
  device_type: string;
  classification: string;
  product_profile: string | null;
}

export function convertiDeviceTypeV21(
  db: Database.Database,
  scrivi: (riga: string) => void = (r) => console.info(r),
): EsitoDeviceTypeV21 {
  if (conversioneChiusa(leggiSegno(db, SEGNO_DEVICE_TYPE_V21))) return { eseguita: false, convertiti: 0 };
  const righe = db
    .prepare(
      `SELECT id, name, device_type, classification, product_profile FROM network_devices
       WHERE device_type = 'switch' AND classification IS NOT NULL AND classification NOT IN ('', 'switch')`,
    )
    .all() as Riga[];
  const cambi = righe
    .map((r) => ({
      r,
      a: resolveDeviceTypeForCreate({
        product_profile: (r.product_profile ?? "generic_iot") as ProductProfileId,
        device_type: "switch",
        classification: r.classification,
      }),
    }))
    .filter((c) => c.a !== c.r.device_type);
  // Prima l'elenco per nome, poi la scrittura: se la transazione fallisce resta traccia di cosa si voleva fare.
  for (const c of cambi) scrivi(`[device_type_v21] ${c.r.id} ${c.r.name} ${c.r.device_type} -> ${c.a} (classificazione ${c.r.classification})`);
  db.transaction(() => {
    const upd = db.prepare("UPDATE network_devices SET device_type = ? WHERE id = ?");
    for (const c of cambi) upd.run(c.a, c.r.id);
    scriviSegno(db, SEGNO_DEVICE_TYPE_V21, `done:${new Date().toISOString()}:convertiti=${cambi.length}`);
  })();
  return { eseguita: true, convertiti: cambi.length };
}
