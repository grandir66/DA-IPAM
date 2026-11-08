/**
 * Ogni Stormshield è un firewall (Riccardo, 08/11: «gli stormshield devono essere rilevati come tali e acquisiti con porte,
 * tabella arp, tabelle di routing, vlan»). Sull'hub SNS EVA2 era registrato `server`: niente scheda da firewall, fuori dal giro
 * dei parser e dalla testa della Topologia. Conversione una tantum come `device_type_v21`: segno `device_type_stormshield` in
 * `tenant_settings`, elenco per nome nel log PRIMA di scrivere, solo `device_type` (la classificazione non si tocca).
 * Dopo, la creazione dà già `firewall` (`resolveDeviceTypeForCreate`). Modulo puro: riceve l'handle.
 */
import type Database from "better-sqlite3";
import { conversioneChiusa, leggiSegno, scriviSegno } from "@/lib/credentials/segni-t2";

export const SEGNO_STORMSHIELD_FIREWALL = "device_type_stormshield";

export function convertiStormshieldFirewall(db: Database.Database, scrivi: (riga: string) => void = (r) => console.info(r)): { eseguita: boolean; convertiti: number } {
  if (conversioneChiusa(leggiSegno(db, SEGNO_STORMSHIELD_FIREWALL))) return { eseguita: false, convertiti: 0 };
  const righe = db.prepare(`SELECT id, name, device_type FROM network_devices
    WHERE (LOWER(COALESCE(vendor, '')) = 'stormshield' OR product_profile = 'stormshield_firewall') AND device_type <> 'firewall'`).all() as Array<{ id: number; name: string; device_type: string }>;
  for (const r of righe) scrivi(`[${SEGNO_STORMSHIELD_FIREWALL}] ${r.id} ${r.name} ${r.device_type} -> firewall`);
  db.transaction(() => {
    const upd = db.prepare("UPDATE network_devices SET device_type = 'firewall' WHERE id = ?");
    for (const r of righe) upd.run(r.id);
    scriviSegno(db, SEGNO_STORMSHIELD_FIREWALL, `done:${new Date().toISOString()}:convertiti=${righe.length}`);
  })();
  return { eseguita: true, convertiti: righe.length };
}
