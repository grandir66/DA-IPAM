/**
 * Interfacce di un apparato per la scheda router e firewall: `network_devices.physical_device_id` →
 * `device_interfaces` + `device_interface_addresses`. Due letture (interfacce, poi tutti gli indirizzi con un JOIN):
 * niente N+1. Senza `physical_device_id` la risposta dice `collegato: false`, che non è «nessuna interfaccia».
 */
import { getDb, getNetworkDeviceById } from "@/lib/db";
import type { InterfacciaScheda } from "@/lib/scheda/router";

export interface RispostaInterfacce {
  interfacce: InterfacciaScheda[];
  fonte: "device_interfaces";
  /** Ultimo `updated_at` fra le interfacce lette; null se non ce ne sono. */
  aggiornato: string | null;
  /** false = l'apparato non è ancora abbinato a un apparato fisico: le interfacce non si sanno, non sono zero. */
  collegato: boolean;
}

interface RigaInterfaccia {
  id: number; ifname: string; mac: string | null; status: string | null; speed_mbps: number | null;
  type: string | null; alias: string | null; updated_at: string | null;
}
interface RigaIndirizzo { interface_id: number; ip: string; prefix: number | null; family: number }

/** null = apparato inesistente (la rotta risponde 404). */
export function interfacceDellApparato(deviceId: number): RispostaInterfacce | null {
  const dev = getNetworkDeviceById(deviceId);
  if (!dev) return null;
  const pd = dev.physical_device_id ?? null;
  if (pd == null) return { interfacce: [], fonte: "device_interfaces", aggiornato: null, collegato: false };

  const db = getDb();
  const righe = db
    .prepare("SELECT id, ifname, mac, status, speed_mbps, type, alias, updated_at FROM device_interfaces WHERE physical_device_id = ? ORDER BY ifindex, ifname")
    .all(pd) as RigaInterfaccia[];
  const indirizzi = db
    .prepare(
      `SELECT a.interface_id, a.ip, a.prefix, a.family
         FROM device_interface_addresses a JOIN device_interfaces i ON i.id = a.interface_id
        WHERE i.physical_device_id = ? ORDER BY a.family, a.ip`,
    )
    .all(pd) as RigaIndirizzo[];

  const perInterfaccia = new Map<number, InterfacciaScheda["indirizzi"]>();
  for (const a of indirizzi) {
    const l = perInterfaccia.get(a.interface_id) ?? [];
    l.push({ ip: a.ip, prefisso: a.prefix, famiglia: a.family === 6 ? 6 : 4 });
    perInterfaccia.set(a.interface_id, l);
  }

  let aggiornato: string | null = null;
  const interfacce = righe.map((r): InterfacciaScheda => {
    if (r.updated_at && (aggiornato == null || r.updated_at > aggiornato)) aggiornato = r.updated_at;
    return {
      ifname: r.ifname,
      alias: r.alias,
      stato: r.status === "up" || r.status === "down" ? r.status : "unknown",
      velocita_mbps: r.speed_mbps,
      tipo: r.type,
      mac: r.mac,
      indirizzi: perInterfaccia.get(r.id) ?? [],
    };
  });
  return { interfacce, fonte: "device_interfaces", aggiornato, collegato: true };
}
