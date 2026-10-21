/**
 * Corpo di GET /api/devices/[id]/mikrotik-scheda (Task 9): bridge, porte (col ruolo STP) e bond dell'ultima fotografia,
 * VLAN dei bridge, interfacce VLAN e DNS (Task 10), più lo stato delle due letture che li riempiono. Gli utenti del router no:
 * li dà solo `rispostaUtentiMikrotik`, dietro `requireAdmin()`. Fuori dal file della rotta per provarlo senza sessione; la rotta mette
 * davanti `requireAuth()` e `withTenantFromSession`. Va chiamato dentro il tenant.
 */
import { contaBridgeMikrotik, dataSchedaMikrotikV3, getNetworkDeviceById, leggiSchedaMikrotik, leggiUtentiMikrotik } from "@/lib/db-tenant";
import type { RigaUtenteMk } from "@/lib/devices/mikrotik-scheda";
import { leggiEsiti, leggiInterruttore } from "@/lib/topology/letture/interruttori";
import type { RispostaSchedaMikrotik } from "@/lib/scheda/mikrotik";

/**
 * Campo `mikrotik` di GET /api/devices/[id]: bridge dell'ultima fotografia (una COUNT) e stato della lettura della topologia,
 * da cui la pagina decide le tab (caso 5: spenta → niente VLAN e Bridge anche con righe di prima). null = schema < 2.
 */
export function riassuntoMikrotik(deviceId: number): { bridge: number; letto_il: string | null; topologia_accesa: boolean } | null {
  const c = contaBridgeMikrotik(deviceId);
  return c ? { ...c, topologia_accesa: leggiInterruttore("mikrotik").acceso } : null;
}

export function rispostaSchedaMikrotik(deviceId: number): { status: 200; body: RispostaSchedaMikrotik } | { status: 400 | 404; body: { error: string } } {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { status: 404, body: { error: "Dispositivo non trovato" } };
  if (device.vendor !== "mikrotik") return { status: 400, body: { error: "Questa scheda è solo per dispositivi MikroTik" } };
  const topologia = leggiInterruttore("mikrotik");
  const esitoScheda = leggiEsiti("mikrotik_scheda")[String(deviceId)];
  const s = leggiSchedaMikrotik(deviceId);
  // Una tabella senza righe è «mai letta» (null) per leggiSchedaMikrotik. Se l'ultima lettura «VLAN, DNS e utenti» ha letto
  // tutti e quattro i comandi, il vuoto è vero: [] (un bridge senza righe VLAN non deve dire «serve la lettura»).
  const completa = !!esitoScheda && esitoScheda.codice === null && esitoScheda.comandi > 0 && esitoScheda.riusciti >= esitoScheda.comandi;
  return {
    status: 200,
    body: {
      ...s,
      vlanBridge: s.vlanBridge ?? (completa ? [] : null),
      vlan: s.vlan ?? (completa ? [] : null),
      letture: {
        topologia: { acceso: topologia.acceso, il: leggiEsiti("mikrotik")[String(deviceId)]?.il ?? null },
        // `il` = ultimo tentativo, `dati_il` = età dei dati mostrati, `codice` = perché l'ultimo tentativo non è andato.
        scheda: {
          acceso: leggiInterruttore("mikrotik_scheda").acceso, il: esitoScheda?.il ?? null,
          dati_il: dataSchedaMikrotikV3(deviceId), codice: esitoScheda?.codice ?? null,
        },
      },
    },
  };
}

/**
 * Corpo di GET /api/devices/[id]/mikrotik-utenti (Task 10): gli utenti del router dall'ultima lettura «VLAN, DNS e utenti».
 * SOLO per l'admin: la rotta mette `requireAdmin()` per prima cosa. Nessuna password (il lettore non la legge). Schema sotto
 * il livello 3 = niente da leggere: elenco vuoto, `letto_il` null, come «mai letti».
 */
export function rispostaUtentiMikrotik(deviceId: number):
  { status: 200; body: { utenti: RigaUtenteMk[]; letto_il: string | null } } | { status: 400 | 404; body: { error: string } } {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { status: 404, body: { error: "Dispositivo non trovato" } };
  if (device.vendor !== "mikrotik") return { status: 400, body: { error: "Questa scheda è solo per dispositivi MikroTik" } };
  return { status: 200, body: leggiUtentiMikrotik(deviceId) ?? { utenti: [], letto_il: null } };
}
