/**
 * Effetti collaterali della canonicalizzazione sul database (catalogo V3-V6, 21/10):
 * il ruolo del server entra in `server_roles`, il vendor entra in
 * `network_devices.vendor` solo se vuoto o `other`. Condiviso da db.ts, db-tenant.ts,
 * attribuzione e conversione una tantum. Riceve l'handle: niente import di db.
 */
import type Database from "better-sqlite3";
import { unisciRuoli, type Canonica } from "./canonico";

type Tabella = "hosts" | "network_devices";

/** Aggiunge il ruolo a `server_roles` della riga. Senza ruolo non fa niente. */
export function aggiungiRuoloServer(dbh: Database.Database, tabella: Tabella, id: number, c: Canonica): void {
  if (!c.ruolo) return;
  const r = dbh.prepare(`SELECT server_roles FROM ${tabella} WHERE id = ?`).get(id) as { server_roles: string | null } | undefined;
  if (!r) return;
  const nuovo = unisciRuoli(r.server_roles, c.ruolo);
  if (nuovo !== r.server_roles) dbh.prepare(`UPDATE ${tabella} SET server_roles = ? WHERE id = ?`).run(nuovo, id);
}

/** Imposta il vendor dell'apparato se è vuoto o `other` (mai sopra uno scelto). */
export function impostaVendorSeVuoto(dbh: Database.Database, deviceId: number, c: Canonica): void {
  if (!c.vendor) return;
  dbh
    .prepare(`UPDATE network_devices SET vendor = ? WHERE id = ? AND (vendor IS NULL OR vendor = '' OR vendor = 'other')`)
    .run(c.vendor, deviceId);
}
