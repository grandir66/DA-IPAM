/**
 * Conversione una tantum di `network_devices.device_type` per le periferiche (09/11/2026, Riccardo). Stampanti, UPS,
 * VoIP, telecamere e IoT ripiegavano su `switch` (o `server`, dalla vecchia finestra in blocco «server + Altro + UPS»):
 * finivano fra gli switch e il giro provava a leggerne porte e MAC. Ora hanno un tipo proprio, e le righe già create si
 * ricalcolano con `resolveDeviceTypeForCreate`. Non tocca `classification`.
 *
 * Solo righe `switch`/`server` con classificazione o profilo da periferica: uno switch vero senza profilo non si muove.
 * Gira dopo `migraCheckNetworkDevices` (dentro `migraCredenzialiWmi`): prima il CHECK rifiuterebbe i tipi nuovi.
 * Segno `device_type_v22` in `tenant_settings`, elenco per nome nel log PRIMA di scrivere, come `device_type_v21`.
 * Modulo puro: riceve l'handle.
 */
import type Database from "better-sqlite3";
import { resolveDeviceTypeForCreate, TIPO_DELLA_CLASSIFICAZIONE_PERIFERICA, type ProductProfileId } from "@/lib/device-product-profiles";
import { conversioneChiusa, leggiSegno, scriviSegno } from "@/lib/credentials/segni-t2";

export const SEGNO_DEVICE_TYPE_V22 = "device_type_v22";

const PROFILI_PERIFERICA = ["hp_stampante", "generic_stampante", "generic_ups", "generic_voip", "cisco_telefono", "generic_cam", "generic_iot"];

export interface EsitoDeviceTypeV22 {
  eseguita: boolean;
  convertiti: number;
}

interface Riga {
  id: number;
  name: string;
  device_type: string;
  classification: string | null;
  product_profile: string | null;
}

export function convertiDeviceTypeV22(
  db: Database.Database,
  scrivi: (riga: string) => void = (r) => console.info(r),
): EsitoDeviceTypeV22 {
  if (conversioneChiusa(leggiSegno(db, SEGNO_DEVICE_TYPE_V22))) return { eseguita: false, convertiti: 0 };
  const classi = Object.keys(TIPO_DELLA_CLASSIFICAZIONE_PERIFERICA);
  const segnaposto = (n: number) => Array(n).fill("?").join(", ");
  const righe = db
    .prepare(
      `SELECT id, name, device_type, classification, product_profile FROM network_devices
       WHERE device_type IN ('switch', 'server')
         AND (classification IN (${segnaposto(classi.length)}) OR product_profile IN (${segnaposto(PROFILI_PERIFERICA.length)}))`,
    )
    .all(...classi, ...PROFILI_PERIFERICA) as Riga[];
  const cambi = righe
    .map((r) => ({
      r,
      a: resolveDeviceTypeForCreate({
        product_profile: (r.product_profile ?? "generic_iot") as ProductProfileId,
        classification: r.classification,
      }),
    }))
    .filter((c) => c.a !== c.r.device_type);
  // Prima l'elenco per nome, poi la scrittura: se la transazione fallisce resta traccia di cosa si voleva fare.
  for (const c of cambi) {
    scrivi(`[device_type_v22] ${c.r.id} ${c.r.name} ${c.r.device_type} -> ${c.a} (classificazione ${c.r.classification ?? "-"}, profilo ${c.r.product_profile ?? "-"})`);
  }
  db.transaction(() => {
    const upd = db.prepare("UPDATE network_devices SET device_type = ? WHERE id = ?");
    for (const c of cambi) upd.run(c.a, c.r.id);
    scriviSegno(db, SEGNO_DEVICE_TYPE_V22, `done:${new Date().toISOString()}:convertiti=${cambi.length}`);
  })();
  return { eseguita: true, convertiti: cambi.length };
}
