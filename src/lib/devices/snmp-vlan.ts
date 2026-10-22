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

export interface LetturaVlanSwitch {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  /** null = lo switch non dichiara gli untagged (o non sono credibili): la U si deduce dal PVID. */
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
  tabella: "static" | "current" | "nessuna";
  mappa_porte: "base_port" | "ifindex";
  /** Come sono scritte le PortList: «standard» come la MIB, «inverso» come la ProMax. */
  ordine_bit: "standard" | "inverso";
  letture: number; riuscite: number; codice: string | null;
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
  const leggi = async (oid: string): Promise<VoceSnmp[] | null> => {
    if (muto) return null;
    letture++;
    try {
      const r = await walk(oid);
      riuscite++;
      return r;
    } catch (e) {
      const c = codiceErrore(e);
      codice ??= c;
      // Lo switch non risponde: le walk dopo si saltano, l'esito è «non so» (mai una lista vuota scritta).
      if (nonSo(c)) muto = true;
      return null;
    }
  };
  const O = OID_QBRIDGE;
  const nomiT = await leggi(O.staticName), sEgrT = await leggi(O.staticEgress), sUntT = await leggi(O.staticUntagged);
  const cEgrT = await leggi(O.currentEgress), cUntT = await leggi(O.currentUntagged);
  const pvidT = await leggi(O.pvid), baseT = await leggi(O.basePortIfIndex);

  const esito: LetturaVlanSwitch["esito"] = muto ? "non_so" : letture > 0 && riuscite === 0 ? "non_riuscito" : "letto";
  const vuota: LetturaVlanSwitch = {
    vlan: [], porte: [], pvid: [], tabella: "nessuna", mappa_porte: "ifindex", ordine_bit: "standard", letture, riuscite, codice, esito,
  };
  if (esito !== "letto") return vuota;

  const nomi = perUltimo(nomiT);
  const sEgr = bitmap(perUltimo(sEgrT)), sUnt = bitmap(perUltimo(sUntT));
  const cEgr = bitmap(perUltimo(cEgrT)), cUnt = bitmap(perUltimo(cUntT));
  const tabella: LetturaVlanSwitch["tabella"] = nomi.size + sEgr.size > 0 ? "static" : cEgr.size + cUnt.size > 0 ? "current" : "nessuna";

  // Porta del bridge → ifIndex; mappa vuota = l'indice è già l'ifIndex (UniFi ProMax).
  const ifDellaPorta = new Map<number, number>();
  for (const [bp, v] of perUltimo(baseT)) {
    const i = numero(v);
    if (i !== null && Number.isInteger(bp)) ifDellaPorta.set(bp, i);
  }
  const mappa_porte: LetturaVlanSwitch["mappa_porte"] = ifDellaPorta.size > 0 ? "base_port" : "ifindex";
  const ifDi = (bp: number): number | null => (ifDellaPorta.size > 0 ? (ifDellaPorta.get(bp) ?? null) : bp);
  const pvidGrezzo = perUltimo(pvidT);

  // L'ordine dei bit: quello che fa cadere più porte fra quelle note; a pari merito, quello della MIB.
  const note = new Set(ifDellaPorta.size > 0 ? ifDellaPorta.keys() : pvidGrezzo.keys());
  const tutte = [...sEgr.values(), ...sUnt.values(), ...cEgr.values(), ...cUnt.values()];
  const punti = (f: (b: Buffer) => number[]) => tutte.reduce((n, b) => n + f(b).filter((p) => note.has(p)).length, 0);
  const ordine_bit: LetturaVlanSwitch["ordine_bit"] = punti(portePortListInverso) > punti(portePortList) ? "inverso" : "standard";
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
  for (const [bp, v] of pvidGrezzo) {
    const n = numero(v), if_index = ifDi(bp);
    if (n !== null && vlanValida(n) && if_index !== null) pvid.push({ if_index, pvid: n });
  }
  pvid.sort((a, b) => a.if_index - b.if_index);

  return { vlan, porte, pvid, tabella, mappa_porte, ordine_bit, letture, riuscite, codice, esito };
}
