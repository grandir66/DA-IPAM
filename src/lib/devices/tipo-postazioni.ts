/**
 * Il tipo degli apparati che sono postazioni (Riccardo, 23/11/2026: «assolutamente da fare… i tipi devono essere presenti
 * ed automatici»). Sul 70791 i PC creati dagli apparati automatici erano tutti «switch» (22), «server» (6) o «nas» (2):
 * `resolveDeviceTypeForCreate` non aveva un caso per le postazioni e ripiegava sul profilo. Ora nascono «workstation»;
 * qui si correggono quelli che ci sono e quelli che diventano postazione dopo (una classificazione cambiata).
 *
 * Non è una conversione una tantum: gira all'apertura del tenant e dopo ogni scansione, ed è idempotente (tocca solo
 * le righe ancora sbagliate). Solo da «switch», «server» e «nas», i tre ripieghi visti: un router o un firewall
 * classificato per sbaglio come postazione non si muove. Elenco per nome nel log PRIMA di scrivere.
 * Richiede il CHECK aggiornato (`migraCheckNetworkDevices`): senza, la scrittura fallisce e la transazione si annulla.
 */
import type Database from "better-sqlite3";
import { CLASSI_POSTAZIONE } from "@/lib/device-product-profiles";

const RIPIEGHI = ["switch", "server", "nas"] as const;

export function allineaTipoPostazioni(db: Database.Database, scrivi: (riga: string) => void = (r) => console.info(r)): number {
  const classi = [...CLASSI_POSTAZIONE];
  const righe = db.prepare(
    `SELECT id, name, device_type, classification FROM network_devices
     WHERE device_type IN (${RIPIEGHI.map(() => "?").join(", ")}) AND classification IN (${classi.map(() => "?").join(", ")})`,
  ).all(...RIPIEGHI, ...classi) as Array<{ id: number; name: string; device_type: string; classification: string }>;
  if (righe.length === 0) return 0;
  for (const r of righe) scrivi(`[tipo postazioni] ${r.id} ${r.name} ${r.device_type} -> workstation (classificazione ${r.classification})`);
  db.transaction(() => {
    const upd = db.prepare("UPDATE network_devices SET device_type = 'workstation', updated_at = datetime('now') WHERE id = ?");
    for (const r of righe) upd.run(r.id);
  })();
  return righe.length;
}
