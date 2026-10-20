/**
 * Il DB del tenant del contesto per la pulizia degli host (piano 2026-10-20): lo usano `pulizia-archivio.ts` e
 * `pulizia-candidati.ts`. `db()` di `db-tenant` non è esportato; senza contesto (`withTenant`) si lancia, mai
 * ripieghi su DEFAULT (scriverebbe o leggerebbe gli host di un altro cliente). Import di `db-tenant` solo
 * statico (CONTEXT §7, ADR 0002).
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";

export function dbCorrente(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant: la pulizia degli host lavora solo dentro withTenant()");
  return getTenantDb(code);
}
