/**
 * Le letture SNMP per la mappa per cavo (spec topologia §13.5.4, SN2-SN9) negli switch che non sono del controller,
 * dietro `topologia.lettura.snmp`. Dieci letture, una per tabella, ognuna con la sua sessione (SN1). Le forme sono quelle
 * delle MIB standard (IF-MIB, BRIDGE-MIB, RSTP-MIB, IEEE8021-MSTP-MIB, LLDP-MIB, LAG-MIB) e della CISCO-CDP-MIB:
 * DEDOTTE DALLE MIB, NON OSSERVATE su un apparato. L'indipendenza dal prodotto si scrive in un ADR solo dopo una lettura
 * SNMP vera. Fatti con le parole dello standard; lo stato di una porta solo dove la porta del bridge si traduce in un
 * ifIndex (SN4: niente ripiego «porta del bridge = ifIndex»). Logica pura sulla funzione di walk.
 *
 * Regola dei null (piano di T2, «Scelte» punto 8): ogni riga porta tutte le colonne che questo lettore conosce, null dove
 * il valore è vuoto o non noto in questo giro (anche quando la sua tabella non ha risposto: mai il valore di prima); le
 * colonne che SNMP non legge (bridge, costo, bordo, BPDU…) mancano da tutte le righe.
 */
import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import type { SnmpWalkFn, VoceSnmp } from "@/lib/devices/snmp-walk";

/** Le dieci tabelle, in ordine di lettura. */
export const TABELLE_SNMP = {
  interfacce: "1.3.6.1.2.1.2.2.1", nomi: "1.3.6.1.2.1.31.1.1.1.1", base: "1.3.6.1.2.1.17.1", stp: "1.3.6.1.2.1.17.2",
  lldpLocali: "1.0.8802.1.1.2.1.3.7.1", lldpRemoti: "1.0.8802.1.1.2.1.4.1.1", lldpIndirizzi: "1.0.8802.1.1.2.1.4.2.1",
  cdp: "1.3.6.1.4.1.9.9.23.1.2.1.1", fasci: "1.2.840.10006.300.43.1.2.1.1", mstpRuoli: "1.3.111.2.802.1.1.6.1.3.1.14",
} as const;

export type VicinoSnmp = {
  localPort: string; remoteDevice: string; remotePort: string; protocol: "lldp" | "cdp" | "mndp";
  remoteIp?: string; remoteMac?: string; remotePlatform?: string; localPortIndex?: number | null; remoteCaps?: string | null;
};
export interface LetturaSnmp extends FattiLettura {
  porte: FattoPortaIn[]; bridge: FattoBridgeIn[]; macs: MacApparatoIn[];
  vicini: VicinoSnmp[]; letture: number; riuscite: number; codice: string | null;
}

const TIPO_IF: Readonly<Record<number, string>> = { 6: "physical", 161: "lag", 135: "vlan", 136: "vlan", 131: "tunnel", 209: "bridge", 71: "wireless" };
const STATO_PORTA: Readonly<Record<number, string>> = { 1: "disabled", 2: "discarding", 3: "discarding", 4: "learning", 5: "forwarding" };
/** IEEE8021-MSTP-MIB, ruolo nell'albero comune: valori della MIB, da verificare sulla prima lettura vera (piano, «Scelte» 3). */
const RUOLO_CIST: Readonly<Record<number, string>> = { 1: "root", 2: "alternate", 3: "designated", 4: "backup" };
const VERSIONE: Readonly<Record<number, string>> = { 0: "stp", 2: "rstp", 3: "mstp" };
const CAPACITA = ["other", "repeater", "bridge", "wlan-ap", "router", "telephone", "docsis", "station"];

const testo = (v: unknown): string => (Buffer.isBuffer(v) ? v.toString("utf8").replace(/\0+$/, "") : String(v ?? "")).trim();
const numero = (v: unknown): number | null => (typeof v === "number" ? v : /^\d+$/.test(testo(v)) ? Number(testo(v)) : null);
const esa = (b: number): string => b.toString(16).padStart(2, "0");
function macDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length === 6 && !v.every((b) => b === 0) ? [...v].map(esa).join(":").toUpperCase() : null;
}
/** Un BridgeId di 8 ottetti nella forma «priorità.mac» (come `bridgeIdNormale` dei MikroTik). */
function bridgeIdDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length >= 8 ? `${v.readUInt16BE(0)}.${[...v.subarray(2, 8)].map(esa).join(":")}` : null;
}
/** La porta designata (2 ottetti: priorità, numero) nella forma di RouterOS, «0x80.N». */
function portaIdDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length === 2 ? `0x${esa(v[0])}.${v[1]}` : null;
}
function capacitaDi(v: unknown): string | null {
  if (!Buffer.isBuffer(v) || v.length === 0) return null;
  const c = CAPACITA.filter((_, i) => (v[0] & (0x80 >> i)) !== 0).sort();
  return c.length > 0 ? c.join(",") : null;
}

/** Le voci di una colonna di una tabella, per indice (il resto dell'OID dopo la colonna). */
function colonna(voci: VoceSnmp[] | null, base: string, col: number): Map<string, VoceSnmp["value"]> {
  const pre = `${base}.${col}.`;
  return new Map((voci ?? []).filter((v) => v.oid.startsWith(pre)).map((v) => [v.oid.slice(pre.length), v.value]));
}

export async function leggiSnmpTopologia(walk: SnmpWalkFn, opz: { lettoreCisco: boolean }): Promise<LetturaSnmp> {
  let letture = 0, riuscite = 0;
  let codice: string | null = null;
  // null = non letta (errore o tempo scaduto, il codice va nel resoconto); [] = letta e vuota.
  const leggi = async (oid: string): Promise<VoceSnmp[] | null> => {
    letture++;
    try {
      const r = await walk(oid);
      riuscite++;
      return r;
    } catch (e) {
      codice ??= codiceErrore(e);
      return null;
    }
  };
  const S = TABELLE_SNMP;
  const ifT = await leggi(S.interfacce), nomiT = await leggi(S.nomi), baseT = await leggi(S.base), stpT = await leggi(S.stp);
  const locT = await leggi(S.lldpLocali), remT = await leggi(S.lldpRemoti), manT = await leggi(S.lldpIndirizzi);
  const cdpT = await leggi(S.cdp), lagT = await leggi(S.fasci), mstpT = await leggi(S.mstpRuoli);

  // IF-MIB (SN7): nome, tipo (mai dal nome), MAC, acceso.
  const descr = colonna(ifT, S.interfacce, 2), tipo = colonna(ifT, S.interfacce, 3), fis = colonna(ifT, S.interfacce, 6), oper = colonna(ifT, S.interfacce, 8);
  const nomi = new Map((nomiT ?? []).map((v) => [v.oid.slice(S.nomi.length + 1), v.value]));
  const nomeDi = (ifIndex: string): string => testo(nomi.get(ifIndex)) || testo(descr.get(ifIndex)) || `if${ifIndex}`;
  // BRIDGE-MIB: porta del bridge → ifIndex (SN3); senza traduzione, niente stato (SN4).
  const ifDellaPorta = new Map<string, string>();
  for (const [bp, v] of colonna(baseT, `${S.base}.4.1`, 2)) {
    const i = numero(v);
    if (i !== null) ifDellaPorta.set(bp, String(i));
  }
  const porteDelBridge = new Set(ifDellaPorta.values());
  const scalare = (col: number): VoceSnmp["value"] | undefined => colonna(stpT, S.stp, col).get("0");
  const statoDi = new Map<string, { stato: string | null; bridge: string | null; porta: string | null }>();
  const stati = colonna(stpT, `${S.stp}.15.1`, 3), desB = colonna(stpT, `${S.stp}.15.1`, 8), desP = colonna(stpT, `${S.stp}.15.1`, 9);
  for (const [bp, v] of stati) {
    const ifIndex = ifDellaPorta.get(bp);
    if (!ifIndex) continue;
    statoDi.set(ifIndex, { stato: STATO_PORTA[numero(v) ?? -1] ?? null, bridge: bridgeIdDi(desB.get(bp)), porta: portaIdDi(desP.get(bp)) });
  }
  // IEEE8021-MSTP-MIB (SN8): il ruolo nell'albero comune, indice «componente.porta del bridge».
  const ruoloDi = new Map<string, string>();
  for (const v of mstpT ?? []) {
    const bp = v.oid.slice(S.mstpRuoli.length + 1).split(".")[1];
    const ifIndex = bp ? ifDellaPorta.get(bp) : undefined;
    const r = RUOLO_CIST[numero(v.value) ?? -1];
    if (ifIndex && r) ruoloDi.set(ifIndex, r);
  }
  // LAG-MIB (SN7): fascio di cui la porta fa parte (ifIndex del fascio; 0 = nessuno) e partner LACP.
  const agg = colonna(lagT, S.fasci, 13), partner = colonna(lagT, S.fasci, 9);
  const porte: FattoPortaIn[] = [];
  const macs: MacApparatoIn[] = [];
  for (const [ifIndex, t] of tipo) {
    const n = numero(t);
    const a = numero(agg.get(ifIndex));
    const st = statoDi.get(ifIndex);
    const op = numero(oper.get(ifIndex));
    porte.push({
      port_key: `i:${ifIndex}`, port_name: nomeDi(ifIndex), port_index: Number(ifIndex), if_kind: n !== null ? (TIPO_IF[n] ?? "other") : null,
      running: op === 1 ? 1 : op === 2 ? 0 : null, in_bridge: baseT === null ? null : porteDelBridge.has(ifIndex) ? 1 : 0,
      lag_group: a !== null && a !== 0 && String(a) !== ifIndex ? `if:${a}` : null, lag_partner: macDi(partner.get(ifIndex)),
      stp_role: ruoloDi.get(ifIndex) ?? null, stp_state: st?.stato ?? null, designated_bridge: st?.bridge ?? null, designated_port: st?.porta ?? null,
    });
    const m = macDi(fis.get(ifIndex));
    if (m) macs.push({ mac: m, port_key: `i:${ifIndex}` });
  }
  // Il bridge (SN2, SN3): versione vera (RSTP-MIB dot1dStpVersion), radice, porta radice tradotta. Una tabella letta senza
  // priorità né radice (spanning tree spento o non esposto) non dà un bridge: una riga vuota con la porta radice null
  // direbbe «è la radice» (stesso criterio di getSnmpStpInfo).
  const indirizzo = macDi(colonna(baseT, S.base, 1).get("0"));
  const prio = numero(scalare(2));
  const radice = bridgeIdDi(scalare(5));
  const rp = numero(scalare(7));
  const bridge: FattoBridgeIn[] = stpT === null || (prio === null && radice === null) ? [] : [{
    bridge_name: "", instance: 0, protocol: VERSIONE[numero(scalare(16)) ?? -1] ?? null, priority: prio,
    bridge_id: indirizzo && prio !== null ? `${prio}.${indirizzo.toLowerCase()}` : null, root_id: radice,
    root_port: rp === null || rp === 0 ? null : (ifDellaPorta.has(String(rp)) ? nomeDi(ifDellaPorta.get(String(rp))!) : `bridge-port:${rp}`),
    root_path_cost: numero(scalare(6)),
  }];
  if (indirizzo) macs.push({ mac: indirizzo, port_key: null });
  // LLDP-MIB (SN5): indice «timeMark.porta locale.remIndex»; la porta locale è il SECONDO pezzo, ed è la porta del bridge.
  const locNome = colonna(locT, S.lldpLocali, 3), locDescr = colonna(locT, S.lldpLocali, 4);
  const ifPerNome = new Map([...tipo.keys()].map((i) => [nomeDi(i).toLowerCase(), i]));
  const ipDi = new Map<string, string>();
  for (const v of manT ?? []) {
    const parti = v.oid.slice(`${S.lldpIndirizzi}.3.`.length).split(".");
    if (!v.oid.startsWith(`${S.lldpIndirizzi}.3.`) || parti.length < 9 || parti[3] !== "1" || parti[4] !== "4") continue;
    ipDi.set(parti.slice(0, 3).join("."), parti.slice(5, 9).join("."));
  }
  const vicini: VicinoSnmp[] = [];
  const sotto = colonna(remT, S.lldpRemoti, 4), telaio = colonna(remT, S.lldpRemoti, 5), sottoPorta = colonna(remT, S.lldpRemoti, 6);
  const portaRem = colonna(remT, S.lldpRemoti, 7), nomeRem = colonna(remT, S.lldpRemoti, 9), capRem = colonna(remT, S.lldpRemoti, 12);
  for (const [k, nome] of nomeRem) {
    const [, porta] = k.split(".");
    const ifIndex = ifDellaPorta.get(porta) ?? ifPerNome.get(testo(locNome.get(porta)).toLowerCase()) ?? ifPerNome.get(testo(locDescr.get(porta)).toLowerCase()) ?? null;
    const mac = numero(sotto.get(k)) === 4 ? macDi(telaio.get(k)) : null;
    const pr = portaRem.get(k);
    const remotePort = numero(sottoPorta.get(k)) === 3 ? (macDi(pr) ?? "") : testo(pr);
    const cap = capacitaDi(capRem.get(k));
    vicini.push({
      localPort: ifIndex ? nomeDi(ifIndex) : (testo(locNome.get(porta)) || testo(locDescr.get(porta)) || `porta ${porta}`),
      localPortIndex: ifIndex ? Number(ifIndex) : null, remoteDevice: testo(nome) || mac || "", remotePort, protocol: "lldp",
      ...(mac ? { remoteMac: mac } : {}), ...(ipDi.has(k) ? { remoteIp: ipDi.get(k) } : {}), ...(cap ? { remoteCaps: cap } : {}),
    });
  }
  // CISCO-CDP-MIB (SN9): «cdp» (annuncio di collegamento) solo se chi legge e la piattaforma annunciata sono tutti e due
  // della marca che lo consuma (elenco chiuso: «cisco» nella piattaforma); altrimenti «mndp» (annuncio di segmento).
  const cdpId = colonna(cdpT, S.cdp, 6), cdpPorta = colonna(cdpT, S.cdp, 7), cdpPiatt = colonna(cdpT, S.cdp, 8), cdpInd = colonna(cdpT, S.cdp, 4);
  for (const [k, id] of cdpId) {
    const ifIndex = k.split(".")[0];
    const piatt = testo(cdpPiatt.get(k));
    const ind = cdpInd.get(k);
    vicini.push({
      localPort: nomeDi(ifIndex), localPortIndex: Number(ifIndex), remoteDevice: testo(id), remotePort: testo(cdpPorta.get(k)),
      protocol: opz.lettoreCisco && /cisco/i.test(piatt) ? "cdp" : "mndp",
      ...(piatt ? { remotePlatform: piatt } : {}), ...(Buffer.isBuffer(ind) && ind.length === 4 ? { remoteIp: [...ind].join(".") } : {}),
    });
  }
  return { porte, bridge, macs, vicini, letture, riuscite, codice };
}
