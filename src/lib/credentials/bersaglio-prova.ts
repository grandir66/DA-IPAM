/**
 * Verso quali indirizzi si può provare una credenziale a mano (terzo giro di sicurezza, 16/11/2026).
 *
 * `POST /api/credentials/<id>/test` prendeva l'indirizzo dal corpo e ci provava la credenziale: chi amministrava
 * l'interfaccia (o aveva preso una sessione da amministratore) la faceva arrivare in chiaro a una macchina sua,
 * anche fuori dalla rete del cliente. Ora l'indirizzo deve stare in una rete dell'inventario, o essere un host o
 * un apparato già conosciuto. Non chiude del tutto (chi amministra può aggiungere una rete, e lo si vede), ma
 * toglie la via diretta.
 */
import type Database from "better-sqlite3";
import { isIpInCidr } from "@/lib/utils";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Valido(s: string): boolean {
  const m = IPV4.exec(s);
  return m !== null && m.slice(1).every((p) => Number(p) <= 255);
}

export interface BersagliNoti {
  /** Le reti dell'inventario, in forma CIDR. */
  reti: string[];
  /** Indirizzi e nomi di host e apparati già in inventario. */
  nomi: string[];
}

export function bersaglioProvaAmmesso(host: string, noti: BersagliNoti): boolean {
  const h = host.trim().toLowerCase();
  if (!h || /\s/.test(h)) return false;
  if (noti.nomi.some((n) => n.trim().toLowerCase() === h)) return true;
  if (!ipv4Valido(h)) return false;
  return noti.reti.some((cidr) => {
    try {
      return isIpInCidr(h, cidr);
    } catch {
      return false;
    }
  });
}

/** Reti, host e apparati dell'installazione, letti dal database del cliente. Una tabella che manca non ferma. */
export function bersagliNotiDb(db: Database.Database, host: string): BersagliNoti {
  const colonna = (sql: string, ...arg: unknown[]): string[] => {
    try {
      return (db.prepare(sql).all(...arg) as Record<string, unknown>[]).flatMap((r) => Object.values(r)).filter((v): v is string => typeof v === "string" && v !== "");
    } catch {
      return [];
    }
  };
  const h = host.trim();
  return {
    reti: colonna("SELECT cidr FROM networks"),
    nomi: [
      ...colonna("SELECT ip, hostname, dns_forward FROM hosts WHERE ip = ? OR hostname = ? COLLATE NOCASE OR dns_forward = ? COLLATE NOCASE LIMIT 5", h, h, h),
      ...colonna("SELECT host FROM network_devices WHERE host = ? COLLATE NOCASE LIMIT 5", h),
    ],
  };
}
