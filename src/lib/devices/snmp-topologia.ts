/**
 * Le letture SNMP per la mappa per cavo (spec topologia §13.5.4, SN2-SN9) negli switch che non sono del controller,
 * dietro `topologia.lettura.snmp`. Sedici letture, ognuna con la sua sessione (SN1): delle tabelle grandi solo le colonne
 * che servono, gli scalari dello spanning tree con un GET (revisione del Task 6, piano «Scelte» 10). Le forme sono quelle
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
import { CODICE_TEMPO_SCADUTO } from "@/lib/devices/ssh-transport";
import type { LettoreSnmp, VoceSnmp } from "@/lib/devices/snmp-walk";

/** Le dieci tabelle (le radici), in ordine di lettura. */
export const TABELLE_SNMP = {
  interfacce: "1.3.6.1.2.1.2.2.1", nomi: "1.3.6.1.2.1.31.1.1.1.1", base: "1.3.6.1.2.1.17.1", stp: "1.3.6.1.2.1.17.2",
  lldpLocali: "1.0.8802.1.1.2.1.3.7.1", lldpRemoti: "1.0.8802.1.1.2.1.4.1.1", lldpIndirizzi: "1.0.8802.1.1.2.1.4.2.1",
  cdp: "1.3.6.1.4.1.9.9.23.1.2.1.1", fasci: "1.2.840.10006.300.43.1.2.1.1", mstpRuoli: "1.3.111.2.802.1.1.6.1.3.1.14",
} as const;

/** La tabella delle porte dello spanning tree (`dot1dStpPortEntry`). */
const PORTE_STP = `${TABELLE_SNMP.stp}.15.1`;
/** Gli scalari dello spanning tree che il lettore usa: priorità, radice, costo, porta radice (BRIDGE-MIB), versione (RSTP-MIB). */
export const SCALARI_STP = [2, 5, 6, 7, 16].map((c) => `${TABELLE_SNMP.stp}.${c}.0`);
/**
 * Le colonne lette delle due tabelle grandi (revisione del Task 6 di T2, piano «Scelte» 10): in v1 (GETNEXT, un valore per
 * richiesta) la tabella intera delle interfacce (22 colonne) e quella delle porte dello spanning tree non stanno nei 10 s.
 * Interfacce: ifDescr (2), ifType (3), ifPhysAddress (6), ifOperStatus (8). Porte STP: stato (3), bridge designato (8),
 * porta designata (9).
 */
export const COLONNE_INTERFACCE = [2, 3, 6, 8].map((c) => `${TABELLE_SNMP.interfacce}.${c}`);
export const COLONNE_PORTE_STP = [3, 8, 9].map((c) => `${PORTE_STP}.${c}`);

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
/**
 * La porta designata nella forma di RouterOS, «0x80.N». Due ottetti: 4 bit di priorità e 12 di numero (802.1D-2004, RSTP;
 * revisione del Task 6: letti come 8+8, la porta 300 con priorità 128 diventava «0x81.44»).
 */
function portaIdDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length === 2 ? `0x${esa(v[0] & 0xf0)}.${((v[0] & 0x0f) << 8) | v[1]}` : null;
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

/** «Non so»: nessuna risposta dell'agente (tempo scaduto o trasporto). Un errore con lo stato SNMP è una risposta («no»). */
const nonSo = (codice: string): boolean => codice === CODICE_TEMPO_SCADUTO || !codice.startsWith("SNMP_STATO_");

export async function leggiSnmpTopologia(walk: LettoreSnmp, opz: { lettoreCisco: boolean }): Promise<LetturaSnmp> {
  let letture = 0, riuscite = 0;
  let codice: string | null = null;
  let muto = false;
  let nonSoDiFila = 0;
  // null = non letta (errore, tempo scaduto, o saltata), il codice va nel resoconto; [] = letta e vuota.
  const leggi = async (fa: () => Promise<VoceSnmp[]>): Promise<VoceSnmp[] | null> => {
    if (muto) return null;
    letture++;
    try {
      const r = await fa();
      riuscite++;
      nonSoDiFila = 0;
      return r;
    } catch (e) {
      const c = codiceErrore(e);
      codice ??= c;
      // Revisione del Task 6 (C4): se la prima lettura non sa dire niente lo switch non risponde (spento, irraggiungibile):
      // le altre si saltano invece di aspettare dieci volte il tempo massimo. Un «no» dell'agente non le salta. Revisione
      // finale di T2 (M4): anche due «non so» di fila a metà giro (lo switch ha smesso di rispondere); uno isolato no.
      nonSoDiFila = nonSo(c) ? nonSoDiFila + 1 : 0;
      if ((letture === 1 && nonSoDiFila === 1) || nonSoDiFila >= 2) muto = true;
      return null;
    }
  };
  const w = (oid: string) => leggi(() => walk(oid));
  const S = TABELLE_SNMP;
  const [descrT, tipoT, fisT, operT] = [await w(COLONNE_INTERFACCE[0]), await w(COLONNE_INTERFACCE[1]), await w(COLONNE_INTERFACCE[2]), await w(COLONNE_INTERFACCE[3])];
  const nomiT = await w(S.nomi), baseT = await w(S.base);
  const scalariT = await leggi(() => walk.get(SCALARI_STP));
  const [statoT, desBT, desPT] = [await w(COLONNE_PORTE_STP[0]), await w(COLONNE_PORTE_STP[1]), await w(COLONNE_PORTE_STP[2])];
  const locT = await w(S.lldpLocali), remT = await w(S.lldpRemoti), manT = await w(S.lldpIndirizzi);
  const cdpT = await w(S.cdp), lagT = await w(S.fasci), mstpT = await w(S.mstpRuoli);

  // IF-MIB (SN7): nome, tipo (mai dal nome), MAC, acceso.
  const descr = colonna(descrT, S.interfacce, 2), tipo = colonna(tipoT, S.interfacce, 3), fis = colonna(fisT, S.interfacce, 6), oper = colonna(operT, S.interfacce, 8);
  const nomi = new Map((nomiT ?? []).map((v) => [v.oid.slice(S.nomi.length + 1), v.value]));
  const nomeNoto = (ifIndex: string): string => testo(nomi.get(ifIndex)) || testo(descr.get(ifIndex));
  const nomeDi = (ifIndex: string): string => nomeNoto(ifIndex) || `if${ifIndex}`;
  // Le interfacce: quelle con un tipo o una descrizione (una colonna che non ha risposto non toglie le porte).
  const indici = [...new Set([...tipo.keys(), ...descr.keys()])];
  // BRIDGE-MIB: porta del bridge → ifIndex (SN3); senza traduzione, niente stato (SN4).
  const ifDellaPorta = new Map<string, string>();
  for (const [bp, v] of colonna(baseT, `${S.base}.4.1`, 2)) {
    const i = numero(v);
    if (i !== null) ifDellaPorta.set(bp, String(i));
  }
  const porteDelBridge = new Set(ifDellaPorta.values());
  const scalare = (col: number): VoceSnmp["value"] | undefined => colonna(scalariT, S.stp, col).get("0");
  const statoDi = new Map<string, { stato: string | null; bridge: string | null; porta: string | null }>();
  const stati = colonna(statoT, PORTE_STP, 3), desB = colonna(desBT, PORTE_STP, 8), desP = colonna(desPT, PORTE_STP, 9);
  for (const bp of new Set([...stati.keys(), ...desB.keys(), ...desP.keys()])) {
    const ifIndex = ifDellaPorta.get(bp);
    if (!ifIndex) continue;
    statoDi.set(ifIndex, { stato: STATO_PORTA[numero(stati.get(bp)) ?? -1] ?? null, bridge: bridgeIdDi(desB.get(bp)), porta: portaIdDi(desP.get(bp)) });
  }
  // IEEE8021-MSTP-MIB (SN8): il ruolo nell'albero comune, indice «componente.porta del bridge».
  const ruoloDi = new Map<string, string>();
  for (const v of mstpT ?? []) {
    const bp = v.oid.slice(S.mstpRuoli.length + 1).split(".")[1];
    const ifIndex = bp ? ifDellaPorta.get(bp) : undefined;
    const r = RUOLO_CIST[numero(v.value) ?? -1];
    if (ifIndex && r) ruoloDi.set(ifIndex, r);
  }
  // LAG-MIB (SN7): fascio di cui la porta fa parte (ifIndex del fascio; 0 = nessuno) e partner LACP. Il fascio si scrive col
  // nome della sua interfaccia, come i MikroTik, anche sulla riga del fascio stesso (ifType 161, o aggregatore di qualcuno);
  // `if:<indice>` solo se l'aggregatore non ha un nome (il traduttore del modello per cavo lo capisce) — revisione del Task 6.
  const agg = colonna(lagT, S.fasci, 13), partner = colonna(lagT, S.fasci, 9);
  const aggregatori = new Set<string>();
  for (const v of agg.values()) {
    const a = numero(v);
    if (a !== null && a !== 0) aggregatori.add(String(a));
  }
  const nomeFascio = (ifIndex: string): string => nomeNoto(ifIndex) || `if:${ifIndex}`;
  const porte: FattoPortaIn[] = [];
  const macs: MacApparatoIn[] = [];
  for (const ifIndex of indici) {
    const n = numero(tipo.get(ifIndex));
    const a = numero(agg.get(ifIndex));
    const st = statoDi.get(ifIndex);
    const op = numero(oper.get(ifIndex));
    const fascio = n === 161 || aggregatori.has(ifIndex) ? nomeFascio(ifIndex) : a !== null && a !== 0 ? nomeFascio(String(a)) : null;
    porte.push({
      port_key: `i:${ifIndex}`, port_name: nomeDi(ifIndex), port_index: Number(ifIndex), if_kind: n !== null ? (TIPO_IF[n] ?? "other") : null,
      // ifOperStatus: up(1); down(2), notPresent(6), lowerLayerDown(7) = ferma; testing, unknown, dormant = non noto.
      running: op === 1 ? 1 : op === 2 || op === 6 || op === 7 ? 0 : null,
      // Una porta assente dalla tabella delle porte del bridge non è «fuori» (revisione del Task 6, C6): con la community senza
      // indice di VLAN un Cisco espone solo le porte della VLAN 1. Non noto, come SN4.
      in_bridge: baseT === null ? null : porteDelBridge.has(ifIndex) ? 1 : null,
      lag_group: fascio, lag_partner: macDi(partner.get(ifIndex)),
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
  const bridge: FattoBridgeIn[] = scalariT === null || (prio === null && radice === null) ? [] : [{
    bridge_name: "", instance: 0, protocol: VERSIONE[numero(scalare(16)) ?? -1] ?? null, priority: prio,
    bridge_id: indirizzo && prio !== null ? `${prio}.${indirizzo.toLowerCase()}` : null, root_id: radice,
    root_port: rp === null || rp === 0 ? null : (ifDellaPorta.has(String(rp)) ? nomeDi(ifDellaPorta.get(String(rp))!) : `bridge-port:${rp}`),
    root_path_cost: numero(scalare(6)),
  }];
  if (indirizzo) macs.push({ mac: indirizzo, port_key: null });
  // LLDP-MIB (SN5): indice «timeMark.porta locale.remIndex»; la porta locale è il SECONDO pezzo, ed è la porta del bridge.
  const locNome = colonna(locT, S.lldpLocali, 3), locDescr = colonna(locT, S.lldpLocali, 4);
  // Nome (minuscolo) → le interfacce con quel nome: un nome vale solo se ne indica una sola.
  const ifPerNome = new Map<string, string[]>();
  for (const i of indici) {
    const k = nomeDi(i).toLowerCase();
    ifPerNome.set(k, [...(ifPerNome.get(k) ?? []), i]);
  }
  /** L'interfaccia di un nome della tabella locale LLDP, se è una sola; il primo nome che ne trova almeno una decide. */
  const ifDelNome = (...nomi: string[]): string | null => {
    for (const n of nomi.map((x) => x.toLowerCase()).filter((x) => x !== "")) {
      const c = ifPerNome.get(n);
      if (c) return c.length === 1 ? c[0] : null;
    }
    return null;
  };
  const ipDi = new Map<string, string>();
  for (const v of manT ?? []) {
    const parti = v.oid.slice(`${S.lldpIndirizzi}.3.`.length).split(".");
    if (!v.oid.startsWith(`${S.lldpIndirizzi}.3.`) || parti.length < 9 || parti[3] !== "1" || parti[4] !== "4") continue;
    ipDi.set(parti.slice(0, 3).join("."), parti.slice(5, 9).join("."));
  }
  const vicini: VicinoSnmp[] = [];
  const sotto = colonna(remT, S.lldpRemoti, 4), telaio = colonna(remT, S.lldpRemoti, 5), sottoPorta = colonna(remT, S.lldpRemoti, 6);
  const portaRem = colonna(remT, S.lldpRemoti, 7), nomeRem = colonna(remT, S.lldpRemoti, 9), capRem = colonna(remT, S.lldpRemoti, 12);
  // Un vicino è una voce del telaio, della porta o del nome (revisione del Task 6, C7): chi non annuncia il nome di sistema
  // c'è lo stesso, col telaio come nome (il MAC, o il testo se il sottotipo non è un indirizzo). Senza niente non si scrive.
  for (const k of new Set([...nomeRem.keys(), ...telaio.keys(), ...portaRem.keys()])) {
    const [, porta] = k.split(".");
    // La porta locale (SN5) è la porta del bridge; ma la MIB permette di numerarla con l'ifIndex, e su quegli apparati la porta
    // del bridge col numero uguale è un'altra (revisione finale di T2, I2). Se il nome della tabella locale dice un'interfaccia
    // sola e diversa, vale il nome, senza indice: il modello per cavo la risolve per nome nell'elenco delle porte.
    const perBridge = ifDellaPorta.get(porta) ?? null;
    const perNome = ifDelNome(testo(locNome.get(porta)), testo(locDescr.get(porta)));
    const discordi = perBridge !== null && perNome !== null && perBridge !== perNome;
    const ifIndex = discordi ? perNome : (perBridge ?? perNome);
    const sottotipo = numero(sotto.get(k));
    const mac = sottotipo === 4 ? macDi(telaio.get(k)) : null;
    const telaioTesto = sottotipo !== 4 && sottotipo !== 5 ? testo(telaio.get(k)) : "";
    const remoteDevice = testo(nomeRem.get(k)) || mac || telaioTesto;
    if (!remoteDevice) continue;
    const pr = portaRem.get(k);
    const remotePort = numero(sottoPorta.get(k)) === 3 ? (macDi(pr) ?? "") : testo(pr);
    const cap = capacitaDi(capRem.get(k));
    vicini.push({
      localPort: ifIndex ? nomeDi(ifIndex) : (testo(locNome.get(porta)) || testo(locDescr.get(porta)) || `porta ${porta}`),
      localPortIndex: ifIndex && !discordi ? Number(ifIndex) : null, remoteDevice, remotePort, protocol: "lldp",
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
