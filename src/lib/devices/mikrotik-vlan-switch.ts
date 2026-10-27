/**
 * Le VLAN di uno switch MikroTik letto via SSH nella matrice della scheda degli switch (giro del 22/10, punto 5; strada scelta
 * da Riccardo il 23/10). RouterOS non dà le VLAN del bridge via SNMP (Q-BRIDGE vuota: 0 VLAN sui sei CORE di 70151); via
 * SSH `/interface bridge vlan` le dà, con le porte per nome. La matrice degli switch lavora per ifIndex (`switch_ports`, che
 * per un MikroTik in SSH legge l'SNMP accanto): un nome di porta diventa l'ifIndex della porta con lo stesso nome (su
 * RouterOS ifName è il nome dell'interfaccia). Il bridge stesso fra i membri (la porta verso la CPU) non è una porta.
 */
import type { LetturaVlanSwitch } from "./snmp-vlan";
import { parsePorteBridgeScheda, parseVlanBridge, type RigaPortaBridgeMk, type RigaVlanBridgeMk } from "./mikrotik-scheda";
import { codiceTrasporto, COMANDI_MK_SCHEDA, interpretaUscita, TEMPO_COMANDO_MS, type Esegui } from "./mikrotik-letture";
import { espandiVlanIds } from "@/lib/scheda/matrice-vlan";

const COMANDO_PORTE_BRIDGE = "/interface bridge port print terse without-paging";
const chiave = (nome: string): string => nome.trim().toLowerCase();

/**
 * Puro. Le righe spente si saltano; gli intervalli si espandono come nella scheda dei MikroTik (più larghi di 64 restano
 * fuori: non sono colonne leggibili). Membri: `current-*` se RouterOS li dà (lo stato vero, dinamiche comprese), altrimenti
 * quelli configurati. Una porta in tutte e due le liste resta U. PVID dalle porte del bridge.
 */
export function vlanSwitchDaMikrotik(
  righe: RigaVlanBridgeMk[],
  portePonte: RigaPortaBridgeMk[] | null,
  porte: ReadonlyArray<{ port_index: number; port_name: string }>,
): LetturaVlanSwitch {
  const indice = new Map(porte.map((p) => [chiave(p.port_name), p.port_index]));
  const ids = new Set<number>();
  const membri = new Map<string, LetturaVlanSwitch["porte"][number]>();
  const senzaMappa = new Set<string>();
  for (const r of righe) {
    if (r.disabled) continue;
    const vlan = espandiVlanIds(r.vlan_ids).map((v) => v.id).filter((v): v is number => v !== null);
    const tagged = r.current_tagged.length || r.current_untagged.length ? r.current_tagged : r.tagged;
    const untagged = r.current_tagged.length || r.current_untagged.length ? r.current_untagged : r.untagged;
    for (const id of vlan) {
      ids.add(id);
      for (const [lista, u] of [[tagged, false], [untagged, true]] as const) {
        for (const nome of lista) {
          if (chiave(nome) === chiave(r.bridge)) continue;
          const ifIndex = indice.get(chiave(nome));
          if (ifIndex === undefined) { senzaMappa.add(chiave(nome)); continue; }
          membri.set(`${id}|${ifIndex}`, { vlan_id: id, if_index: ifIndex, egress: true, untagged: u });
        }
      }
    }
  }
  const pvid: LetturaVlanSwitch["pvid"] = [];
  for (const p of portePonte ?? []) {
    const ifIndex = indice.get(chiave(p.interface));
    if (ifIndex !== undefined && p.pvid !== null) pvid.push({ if_index: ifIndex, pvid: p.pvid });
  }
  return {
    vlan: [...ids].sort((a, b) => a - b).map((vlan_id) => ({ vlan_id, nome: null })),
    porte: [...membri.values()],
    pvid,
    tabella: "mikrotik", mappa_porte: "ifindex", ordine_bit: "standard", porte_senza_mappa: senzaMappa.size,
    letture: 0, riuscite: 0, codice: null, codici: {}, esito: "letto",
  };
}

/**
 * Due comandi in sola lettura su una connessione (quella di `esegui`). Le VLAN del bridge sono necessarie: se non si
 * leggono l'esito è «non riuscito» col codice e niente si scrive; le porte del bridge (solo il PVID) possono mancare.
 */
export async function leggiVlanSwitchMikrotik(esegui: Esegui, porte: ReadonlyArray<{ port_index: number; port_name: string }>): Promise<LetturaVlanSwitch> {
  let riuscite = 0;
  let codice: string | null = null;
  const prova = async <T>(cmd: string, leggi: (out: string) => T[]): Promise<T[] | null> => {
    try {
      const r = interpretaUscita(await esegui(cmd, TEMPO_COMANDO_MS), leggi);
      if ("codice" in r) { codice ??= r.codice; return null; }
      riuscite++;
      return r.valore;
    } catch (e) {
      codice ??= codiceTrasporto(e);
      return null;
    }
  };
  const righe = await prova(COMANDI_MK_SCHEDA.vlanBridge, parseVlanBridge);
  const portePonte = await prova(COMANDO_PORTE_BRIDGE, parsePorteBridgeScheda);
  if (righe === null) {
    return {
      vlan: [], porte: [], pvid: [], tabella: "mikrotik", mappa_porte: "ifindex", ordine_bit: "standard", porte_senza_mappa: 0,
      letture: 2, riuscite, codice, codici: {}, esito: "non_riuscito",
    };
  }
  return { ...vlanSwitchDaMikrotik(righe, portePonte, porte), letture: 2, riuscite, codice };
}
