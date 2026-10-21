/**
 * Corpo di GET /api/devices/[id]/mikrotik-scheda (Task 9): bridge, porte (col ruolo STP) e bond dell'ultima fotografia,
 * più lo stato delle due letture che li riempiono. Fuori dal file della rotta per provarlo senza sessione; la rotta mette
 * davanti `requireAuth()` e `withTenantFromSession`. Va chiamato dentro il tenant.
 */
import { getNetworkDeviceById, leggiSchedaMikrotik } from "@/lib/db-tenant";
import { leggiEsiti, leggiInterruttore } from "@/lib/topology/letture/interruttori";
import type { RispostaSchedaMikrotik } from "@/lib/scheda/mikrotik";

export function rispostaSchedaMikrotik(deviceId: number): { status: 200; body: RispostaSchedaMikrotik } | { status: 400 | 404; body: { error: string } } {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { status: 404, body: { error: "Dispositivo non trovato" } };
  if (device.vendor !== "mikrotik") return { status: 400, body: { error: "Questa scheda è solo per dispositivi MikroTik" } };
  const topologia = leggiInterruttore("mikrotik");
  return {
    status: 200,
    body: {
      ...leggiSchedaMikrotik(deviceId),
      letture: {
        topologia: { acceso: topologia.acceso, il: leggiEsiti("mikrotik")[String(deviceId)]?.il ?? null },
        // La lettura «VLAN, DNS e utenti dei MikroTik» arriva col Task 10.
        scheda: { acceso: false, il: null },
      },
    },
  };
}
