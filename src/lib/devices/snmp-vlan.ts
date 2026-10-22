/**
 * Le VLAN di uno switch via SNMP (piano «accorpamento IP e matrice VLAN degli switch», Task 7): Q-BRIDGE-MIB
 * (dot1qVlanStatic, dot1qVlanCurrent, dot1qPvid) e BRIDGE-MIB (dot1dBasePortIfIndex). Sette walk in sola lettura, ognuna
 * col suo esito; logica pura sulla funzione di walk. Costruito sulle uscite VERE dei tre switch dell'hub (22/10, fixture
 * `qbridge-*.json`), che smentiscono la MIB in tre punti:
 *
 * - le porte di una VLAN si prendono dalla tabella Current (lo stato in uso) quando la VLAN c'è, dalla Static altrimenti:
 *   il SW-CED-16XG dichiara nella Static le porte 1-16 untagged in tutte le VLAN tranne la 1, anche dove non escono;
 * - un untagged vale solo se la porta esce nella VLAN (egress);
 * - la ProMax scrive le PortList al contrario (bit meno significativo dell'ultimo ottetto = porta 0): l'ordine si sceglie
 *   da quante porte cadono fra quelle note (mappa del bridge o indici del PVID); con l'ordine al contrario gli untagged
 *   dichiarati non valgono (16 bit su 48 contraddicono il PVID) e restano `null`: la U si deduce dal PVID.
 *
 * Porte: bit → porta del bridge → ifIndex con `dot1dBasePortIfIndex`; mappa vuota → l'indice è già l'ifIndex (stessa regola
 * di `snmp-port-schema.ts`). Tre esiti: un tempo scaduto o un trasporto caduto su una walk qualsiasi = «non so» (le walk
 * dopo si saltano); tutte rifiutate dall'agente = «non riuscito»; altrimenti «letto», anche vuoto.
 */
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { CODICE_TEMPO_SCADUTO } from "@/lib/devices/ssh-transport";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";

/** Q-BRIDGE-MIB (dot1qVlanStatic, dot1qVlanCurrent, dot1qPvid) e BRIDGE-MIB (dot1dBasePortIfIndex), in ordine di lettura. */
export const OID_QBRIDGE = {
  staticName: "1.3.6.1.2.1.17.7.1.4.3.1.1", staticEgress: "1.3.6.1.2.1.17.7.1.4.3.1.2", staticUntagged: "1.3.6.1.2.1.17.7.1.4.3.1.4",
  currentEgress: "1.3.6.1.2.1.17.7.1.4.2.1.4", currentUntagged: "1.3.6.1.2.1.17.7.1.4.2.1.5",
  pvid: "1.3.6.1.2.1.17.7.1.4.5.1.1", basePortIfIndex: "1.3.6.1.2.1.17.1.4.1.2",
} as const;

export type NomeWalk = keyof typeof OID_QBRIDGE;

export interface LetturaVlanSwitch {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  /** null = lo switch non dichiara gli untagged (o non sono credibili): la U si deduce dal PVID. */
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
  tabella: "static" | "current" | "nessuna";
  mappa_porte: "base_port" | "ifindex";
  /** Come sono scritte le PortList: «standard» come la MIB, «inverso» come la ProMax. */
  ordine_bit: "standard" | "inverso";
  /** Porte del bridge (bit dell'egress o indice del PVID) scartate perché la mappa del bridge non le traduce. */
  porte_senza_mappa: number;
  letture: number; riuscite: number; codice: string | null;
  /** Il codice d'errore di ogni walk che non ha risposto (le assenti hanno risposto). */
  codici: Partial<Record<NomeWalk, string>>;
  esito: "letto" | "non_riuscito" | "non_so";
}

/** PortList (bit più alto del primo ottetto = porta 1) → numeri di porta del bridge. */
export function portePortList(v: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) for (let k = 0; k < 8; k++) if (v[i] & (0x80 >> k)) out.push(i * 8 + k + 1);
  return out;
}

/** PortList scritta al contrario (ProMax): bit meno significativo dell'ultimo ottetto = porta 0, che non esiste. */
function portePortListInverso(v: Buffer): number[] {
  const out: number[] = [];
  for (let i = v.length - 1; i >= 0; i--) for (let k = 0; k < 8; k++) if (v[i] & (1 << k)) out.push((v.length - 1 - i) * 8 + k);
  return out.filter((p) => p > 0);
}

const testo = (v: unknown): string => (Buffer.isBuffer(v) ? v.toString("utf8").replace(/\0+$/, "") : String(v ?? "")).trim();
const numero = (v: unknown): number | null => (typeof v === "number" ? v : /^\d+$/.test(testo(v)) ? Number(testo(v)) : null);
const vlanValida = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 4094;

/** Le voci per l'ultimo componente dell'indice: Static* = `<oid>.<vid>`, Current* = `<oid>.<timeMark>.<vid>`. */
function perUltimo(voci: VoceSnmp[] | null): Map<number, VoceSnmp["value"]> {
  return new Map((voci ?? []).map((v) => [Number(v.oid.split(".").pop()), v.value]));
}
const bitmap = (m: Map<number, VoceSnmp["value"]>): Map<number, Buffer> =>
  new Map([...m].filter((e): e is [number, Buffer] => Buffer.isBuffer(e[1])));

/** «Non so»: nessuna risposta dell'agente (tempo scaduto o trasporto). Un errore con lo stato SNMP è una risposta («no»). */
const nonSo = (codice: string): boolean => codice === CODICE_TEMPO_SCADUTO || !codice.startsWith("SNMP_STATO_");

export async function leggiVlanSwitch(walk: LettoreSnmp): Promise<LetturaVlanSwitch> {
  let letture = 0, riuscite = 0, muto = false;
  let codice: string | null = null;
  const codici: Partial<Record<NomeWalk, string>> = {};
  const leggi = async (nome: NomeWalk): Promise<VoceSnmp[] | null> => {
    if (muto) return null;
    letture++;
    try {
      const r = await walk(OID_QBRIDGE[nome]);
      riuscite++;
      return r;
    } catch (e) {
      const c = codiceErrore(e);
      codice ??= c;
      codici[nome] = c;
      // Lo switch non risponde: le walk dopo si saltano, l'esito è «non so» (mai una lista vuota scritta).
      if (nonSo(c)) muto = true;
      return null;
    }
  };
  const nomiT = await leggi("staticName"), sEgrT = await leggi("staticEgress"), sUntT = await leggi("staticUntagged");
  const cEgrT = await leggi("currentEgress"), cUntT = await leggi("currentUntagged");
  const pvidT = await leggi("pvid"), baseT = await leggi("basePortIfIndex");

  const nomi = perUltimo(nomiT);
  const sEgr = bitmap(perUltimo(sEgrT)), sUnt = bitmap(perUltimo(sUntT));
  const cEgr = bitmap(perUltimo(cEgrT)), cUnt = bitmap(perUltimo(cUntT));
  const pvidGrezzo = perUltimo(pvidT);
  // Revisione del Task 7: un rifiuto parziale non diventa «letto» con porte sbagliate. Il ripiego bit = ifIndex vale
  // solo se la mappa del bridge ha risposto (anche vuota, la ProMax); VLAN note senza nessuna Egress letta = non riuscito.
  const daTradurre = sEgr.size + sUnt.size + cEgr.size + cUnt.size + pvidGrezzo.size > 0;
  const parziale = (baseT === null && daTradurre) || (nomi.size > 0 && sEgrT === null && cEgrT === null);
  const esito: LetturaVlanSwitch["esito"] = muto ? "non_so" : (letture > 0 && riuscite === 0) || parziale ? "non_riuscito" : "letto";
  const vuota: LetturaVlanSwitch = {
    vlan: [], porte: [], pvid: [], tabella: "nessuna", mappa_porte: "ifindex", ordine_bit: "standard", porte_senza_mappa: 0,
    letture, riuscite, codice, codici, esito,
  };
  if (esito !== "letto") return vuota;

  const tabella: LetturaVlanSwitch["tabella"] = nomi.size + sEgr.size > 0 ? "static" : cEgr.size + cUnt.size > 0 ? "current" : "nessuna";

  // Porta del bridge → ifIndex; mappa vuota = l'indice è già l'ifIndex (UniFi ProMax).
  const ifDellaPorta = new Map<number, number>();
  for (const [bp, v] of perUltimo(baseT)) {
    const i = numero(v);
    if (i !== null && Number.isInteger(bp)) ifDellaPorta.set(bp, i);
  }
  const mappa_porte: LetturaVlanSwitch["mappa_porte"] = ifDellaPorta.size > 0 ? "base_port" : "ifindex";
  const senzaMappa = new Set<number>();
  const ifDi = (bp: number): number | null => {
    if (ifDellaPorta.size === 0) return bp;
    const i = ifDellaPorta.get(bp);
    if (i === undefined) senzaMappa.add(bp);
    return i ?? null;
  };

  // L'ordine dei bit: al contrario solo con un margine netto (revisione del Task 7) — nell'ordine della MIB al più metà
  // dei bit accesi cade fra le porte note, al contrario almeno il 90% — e con tutte le PortList della stessa lunghezza
  // (un ottetto in meno, letto al contrario, sposterebbe le porte di 8).
  const note = new Set(ifDellaPorta.size > 0 ? ifDellaPorta.keys() : pvidGrezzo.keys());
  const tutte = [...sEgr.values(), ...sUnt.values(), ...cEgr.values(), ...cUnt.values()];
  const quota = (f: (b: Buffer) => number[]): number => {
    const porte = tutte.flatMap(f);
    return porte.length === 0 ? 0 : porte.filter((p) => note.has(p)).length / porte.length;
  };
  const stessaLunghezza = new Set(tutte.map((b) => b.length)).size === 1;
  const inverso = stessaLunghezza && quota(portePortList) <= 0.5 && quota(portePortListInverso) >= 0.9;
  const ordine_bit: LetturaVlanSwitch["ordine_bit"] = inverso ? "inverso" : "standard";
  const porteDi = ordine_bit === "inverso" ? portePortListInverso : portePortList;

  const ids = [...new Set([...nomi.keys(), ...sEgr.keys(), ...cEgr.keys()])].filter(vlanValida).sort((a, b) => a - b);
  const vlan = ids.map((vlan_id) => ({ vlan_id, nome: testo(nomi.get(vlan_id)) || null }));

  const porte: LetturaVlanSwitch["porte"] = [];
  for (const vlan_id of ids) {
    // Le porte dalla Current quando la VLAN c'è (stato in uso), dalla Static altrimenti: mai mescolate.
    const daCurrent = cEgr.has(vlan_id);
    const egr = daCurrent ? cEgr.get(vlan_id) : sEgr.get(vlan_id);
    const untT = daCurrent ? cUnt : sUnt;
    const dichiarati = untT.size > 0 && ordine_bit === "standard";
    const unt = new Set(dichiarati && untT.has(vlan_id) ? porteDi(untT.get(vlan_id)!) : []);
    const viste = new Set<number>();
    for (const bp of egr ? porteDi(egr) : []) {
      const if_index = ifDi(bp);
      if (if_index === null || viste.has(if_index)) continue;
      viste.add(if_index);
      porte.push({ vlan_id, if_index, egress: true, untagged: dichiarati ? unt.has(bp) : null });
    }
  }

  const pvid: LetturaVlanSwitch["pvid"] = [];
  // Due porte del bridge sullo stesso ifIndex (mappa sbagliata): un PVID solo, il primo, come per le porte delle VLAN.
  const pvidVisti = new Set<number>();
  for (const [bp, v] of pvidGrezzo) {
    const n = numero(v), if_index = ifDi(bp);
    if (n === null || !vlanValida(n) || if_index === null || pvidVisti.has(if_index)) continue;
    pvidVisti.add(if_index);
    pvid.push({ if_index, pvid: n });
  }
  pvid.sort((a, b) => a.if_index - b.if_index);

  return { vlan, porte, pvid, tabella, mappa_porte, ordine_bit, porte_senza_mappa: senzaMappa.size, letture, riuscite, codice, codici, esito };
}
