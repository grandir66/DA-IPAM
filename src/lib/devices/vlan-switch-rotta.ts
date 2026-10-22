/**
 * Corpo di GET /api/devices/[id]/vlan-switch (piano 2026-10-22 accorpamento, Task 11): la matrice porte × VLAN dello switch
 * dalle tabelle `switch_vlan*` e lo stato della lettura «VLAN degli switch via SNMP» (ADR 0029). Solo DB: aprire la tab non
 * manda niente allo switch. Fuori dal file della rotta per provarlo senza sessione; la rotta mette davanti `requireAuth()` e
 * `withTenantFromSession`. Va chiamato dentro il tenant.
 */
import { getNetworkDeviceById, getSwitchPortsByDevice, leggiVlanSwitchDb } from "@/lib/db-tenant";
import { leggiEsiti, leggiInterruttore, type EsitoApparato } from "@/lib/topology/letture/interruttori";
import { matriceVlanSwitch, type MatriceVlanSwitch } from "@/lib/scheda/vlan-switch";

export interface RispostaVlanSwitch {
  matrice: MatriceVlanSwitch;
  lettura: { acceso: boolean; letto_il: string | null; tabella: string | null; esito: EsitoApparato | null };
}

export function rispostaVlanSwitch(deviceId: number): { status: 200; body: RispostaVlanSwitch } | { status: 404; body: { error: string } } {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { status: 404, body: { error: "Dispositivo non trovato" } };
  const db = leggiVlanSwitchDb(deviceId);
  return {
    status: 200,
    body: {
      matrice: matriceVlanSwitch({ porte: getSwitchPortsByDevice(deviceId), db }),
      lettura: {
        acceso: leggiInterruttore("switch_vlan").acceso,
        letto_il: db.lettura?.letto_il ?? null,
        tabella: db.lettura?.tabella ?? null,
        esito: leggiEsiti("switch_vlan")[String(deviceId)] ?? null,
      },
    },
  };
}
