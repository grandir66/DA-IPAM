import type Database from "better-sqlite3";

/**
 * Una coppia MAC/IP già scritta nelle ultime 24 ore non si riscrive.
 *
 * `mac_ip_mapping` tiene un solo IP per MAC. Un MAC che ha più IP insieme (router
 * con più VLAN, bridge Proxmox, due host col MAC uguale) lo cambia a ogni lettura,
 * e quei passaggi non sono spostamenti: sull'hub, il 07/11/2026, facevano 13,6
 * milioni di righe per 772 coppie. Un IP nuovo si scrive subito; chi torna su un IP
 * che non aveva da più di un giorno pure, e `fino_al` delle schede host resta
 * preciso al giorno. Si passa da qui anche per la facciata `db.ts`: una regola sola.
 */
export function registraCambioIp(d: Database.Database, macHex: string, ip: string, source: string): void {
  d.prepare(`INSERT INTO mac_ip_history (mac_normalized, ip, source)
    SELECT ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM mac_ip_history WHERE mac_normalized = ? AND ip = ? AND changed_at >= datetime('now', '-1 day')
    )`).run(macHex, ip, source, macHex, ip);
}
