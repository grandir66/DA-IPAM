/**
 * Sonde note (22/11/2026): le macchine che scandiscono la rete per mestiere, IPAM per primo.
 *
 * Incidente: dal 20 al 22/11 sull'IPAM dell'ufficio 172.238 righe di coppie su 193.128 erano
 * le scansioni di IPAM stesso viste dal collector, e 1.102 avvisi «host non censito» su 1.114
 * erano gli indirizzi che lui aveva provato. Le scansioni finivano anche nelle abitudini.
 *
 * Il traffico di una sonda nota non si salva e non dà avvisi:
 * - tutto ciò che la sonda apre (lei è il client);
 * - le risposte alle sue prove: righe verso di lei senza una porta di servizio (porta 0) o ICMP.
 * Resta chi apre un servizio della sonda (la pagina di IPAM sulla 443).
 */
import { networkInterfaces } from "node:os";
import type Database from "better-sqlite3";
import { getTenantSetting, setTenantSetting } from "@/lib/db-tenant";

export const CHIAVE_SONDE = "traffico_sonde_note";
const CHIAVE_PULITE = "traffico_sonde_pulite";
const CHIAVE_REGOLE = "traffico_regole";
/** Si alza quando cambiano le regole di `non_censito` e `vlan_chiuse`: gli avvisi «nuova» fatti con le vecchie si rifanno. */
const VERSIONE_REGOLE = "2";
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const MAX_SONDE = 50;

export const ipValido = (ip: string): boolean => IPV4.test(ip);

/** Gli indirizzi IPv4 di questa macchina: IPAM scandisce da qui. */
export function indirizziPropri(): string[] {
  const trovati: string[] = [];
  for (const schede of Object.values(networkInterfaces())) {
    for (const s of schede ?? []) if (s.family === "IPv4" && !s.internal) trovati.push(s.address);
  }
  return [...new Set(trovati)].sort();
}

/** Le sonde aggiunte a mano per questo cliente (Edge, Zabbix, LibreNMS). */
export function sondeAggiunte(): string[] {
  return (getTenantSetting(CHIAVE_SONDE) ?? "").split(",").map((x) => x.trim()).filter(ipValido);
}

export function impostaSondeAggiunte(ip: string[]): string[] {
  const buone = [...new Set(ip.map((x) => x.trim()).filter(ipValido))].sort().slice(0, MAX_SONDE);
  setTenantSetting(CHIAVE_SONDE, buone.join(","));
  return buone;
}

export function sondeNote(): Set<string> {
  return new Set([...indirizziPropri(), ...sondeAggiunte()]);
}

export function rumoreDiSonda(r: { client: string; server: string; proto: number; porta: number }, sonde: Set<string>): boolean {
  if (sonde.size === 0) return false;
  return sonde.has(r.client) || (sonde.has(r.server) && (r.porta === 0 || r.proto === 1));
}

/**
 * Toglie ciò che è stato salvato prima di conoscere una sonda, e gli avvisi «nuova» fatti con
 * regole superate. Gira solo quando l'elenco delle sonde o la versione delle regole cambia.
 * Non tocca gli avvisi che una persona ha già segnato «vista» o «normale», né le abitudini confermate.
 */
export function ripulisciRumore(d: Database.Database, sonde: Set<string>): { coppie: number; abitudini: number; anomalie: number } {
  const esito = { coppie: 0, abitudini: 0, anomalie: 0 };
  const elenco = [...sonde].sort();
  const firma = elenco.join(",");
  const regoleVecchie = getTenantSetting(CHIAVE_REGOLE) !== VERSIONE_REGOLE;
  const sondeCambiate = (getTenantSetting(CHIAVE_PULITE) ?? "") !== firma;
  if (!regoleVecchie && !sondeCambiate) return esito;
  d.transaction(() => {
    if (regoleVecchie) {
      esito.anomalie += d.prepare("DELETE FROM traffico_anomalie WHERE stato = 'nuova' AND tipo IN ('non_censito', 'vlan_chiuse')").run().changes;
    }
    if (sondeCambiate && elenco.length > 0) {
      const q = elenco.map(() => "?").join(",");
      const dove = `client IN (${q}) OR (server IN (${q}) AND (porta = 0 OR proto = 1))`;
      esito.coppie = d.prepare(`DELETE FROM traffico_coppie WHERE ${dove}`).run(...elenco, ...elenco).changes;
      d.prepare(`DELETE FROM traffico_ore WHERE ${dove}`).run(...elenco, ...elenco);
      d.prepare(`DELETE FROM traffico_connessioni WHERE client IN (${q})`).run(...elenco);
      esito.abitudini = d.prepare(`DELETE FROM traffico_abitudini WHERE confermata = 0 AND (${dove})`).run(...elenco, ...elenco).changes;
      esito.anomalie += d.prepare(`DELETE FROM traffico_anomalie WHERE stato = 'nuova' AND client IN (${q})`).run(...elenco).changes;
    }
  })();
  setTenantSetting(CHIAVE_REGOLE, VERSIONE_REGOLE);
  setTenantSetting(CHIAVE_PULITE, firma);
  return esito;
}
