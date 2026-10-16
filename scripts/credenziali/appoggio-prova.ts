// scripts/credenziali/appoggio-prova.ts
/**
 * Misure della prova a vuoto delle migrazioni della tappa 2 credenziali (T11
 * del piano 2026-10-15-tappa2-archivio-credenziali; si estende nei T16, T19,
 * T22 e T27).
 *
 * Si carica SOLO con `await import()` da `prova-a-vuoto.ts`, DOPO che lo
 * script ha spostato DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH su --dati:
 * db-tenant e db-hub fissano i percorsi quando si caricano. Qui db-tenant si
 * importa staticamente (ADR 0002: l'import dinamico vietato è quello di
 * db-tenant stesso, non di un modulo che lo importa).
 *
 * Una misura legge, non scrive: righe e figli di `credentials`, violazioni
 * delle chiavi esterne, contatore, i segni `credenziali_t2_*` e le voci (id,
 * nome, tipo), che lo script stampa a terminale e mai su file.
 *
 * Dalla 2d (T16) anche le catene: righe della lista delle reti, delle righe
 * host, delle catene vecchie e dei pin; la lista e le righe host per id; per
 * ogni rete la sequenza del motore (voce:porta) per ssh, winrm e snmp, con le
 * chiavi dell'hub della copia, senza registrare ripieghi. È la proprietà della
 * 2d: la sequenza non cambia con la conversione.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cartellaTenant, closeAllTenantDbs, closeTenantDb, getTenantDb, withTenant } from "../../src/lib/db-tenant";
import { closeHubDb, getHubDbPath, getSetting } from "../../src/lib/db-hub";
import { statoCredenziali, type StatoCredenziali } from "../../src/lib/credentials/migra-credenziali-tipi";
import { chiaviGlobaliHub, resolveCredentialsForDb, type CredProtocol } from "../../src/lib/credentials/resolve";

export { cartellaTenant, getHubDbPath };

const CODICE_TENANT = /^([A-Za-z0-9_-]+)\.db$/;

export function elencaTenant(): string[] {
  return fs
    .readdirSync(cartellaTenant())
    .map((f) => CODICE_TENANT.exec(f)?.[1])
    .filter((c): c is string => !!c)
    .sort();
}

export interface Voce {
  id: number;
  name: string;
  credential_type: string;
}

export const PROTOCOLLI_CATENE: readonly CredProtocol[] = ["ssh", "winrm", "snmp"];

export interface MisuraCatene {
  /** null se le tabelle non ci sono (schema di prima). */
  righe: { lista: number; righeHost: number; catenaVecchia: number; pin: number } | null;
  lista: Array<{ network_id: number; credential_id: number }>;
  righeHost: Array<{ id: number; host_id: number; ip: string; credential_id: number; protocol_type: string; port: number }>;
  reti: Record<string, string>;
  /** `<network_id>:<protocollo>` → ["<voce>:<porta>", …] nell'ordine del motore. */
  catene: Record<string, string[]>;
  /** Il motore non si è potuto interrogare: il messaggio. */
  errore: string | null;
}

export interface Misura {
  stato: StatoCredenziali;
  segni: Record<string, string>;
  voci: Voce[];
  catene: MisuraCatene;
}

function haTabella(dbh: Database.Database, nome: string): boolean {
  return !!dbh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

function misuraCatene(dbh: Database.Database): MisuraCatene {
  const out: MisuraCatene = { righe: null, lista: [], righeHost: [], reti: {}, catene: {}, errore: null };
  const tabelle = ["networks", "hosts", "network_credentials", "host_credentials", "network_host_credentials", "host_detect_credential"];
  if (!tabelle.every((t) => haTabella(dbh, t))) return out;
  const conta = (t: string) => (dbh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  out.righe = {
    lista: conta("network_credentials"),
    righeHost: conta("host_credentials"),
    catenaVecchia: conta("network_host_credentials"),
    pin: conta("host_detect_credential"),
  };
  out.lista = dbh.prepare("SELECT network_id, credential_id FROM network_credentials ORDER BY network_id, sort_order, id").all() as MisuraCatene["lista"];
  out.righeHost = dbh
    .prepare(
      `SELECT hc.id, hc.host_id, COALESCE(h.ip, '?') AS ip, hc.credential_id, hc.protocol_type, hc.port
       FROM host_credentials hc LEFT JOIN hosts h ON h.id = hc.host_id ORDER BY hc.id`
    )
    .all() as MisuraCatene["righeHost"];
  const reti = dbh.prepare("SELECT id, name FROM networks ORDER BY id").all() as Array<{ id: number; name: string }>;
  for (const r of reti) out.reti[String(r.id)] = r.name;
  try {
    const globaliHub = chiaviGlobaliHub(getSetting);
    for (const r of reti) {
      for (const p of PROTOCOLLI_CATENE) {
        out.catene[`${r.id}:${p}`] = resolveCredentialsForDb(dbh, { networkId: r.id }, p, { globaliHub, registra: false }).map(
          (c) => `${c.credential_id ?? "-"}:${c.port}`
        );
      }
    }
  } catch (e) {
    out.errore = e instanceof Error ? e.message : String(e);
  }
  return out;
}

function misuraHandle(dbh: Database.Database): Misura {
  const haSettings = dbh.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenant_settings'").get();
  const segni = haSettings
    ? Object.fromEntries(
        (dbh.prepare("SELECT key, value FROM tenant_settings WHERE key LIKE 'credenziali_t2_%' ORDER BY key").all() as Array<{ key: string; value: string }>).map(
          (r) => [r.key, r.value]
        )
      )
    : {};
  return {
    stato: statoCredenziali(dbh, { violazioni: true }),
    segni,
    voci: dbh.prepare("SELECT id, name, credential_type FROM credentials ORDER BY id").all() as Voce[],
    catene: misuraCatene(dbh),
  };
}

/** Misura in sola lettura, prima di qualunque migrazione: il file si apre in readonly e si chiude. */
export function misuraFile(code: string): Misura {
  const dbh = new Database(path.join(cartellaTenant(), `${code}.db`), { readonly: true, fileMustExist: true });
  try {
    return misuraHandle(dbh);
  } finally {
    dbh.close();
  }
}

/** Apre il tenant con getTenantDb (tutte le migrazioni, come al riavvio vero), misura e chiude. */
export function apriEMisura(code: string): Misura {
  try {
    const dbh = withTenant(code, () => getTenantDb(code));
    return misuraHandle(dbh);
  } finally {
    closeTenantDb(code);
  }
}

export function chiudiTutto(): void {
  closeAllTenantDbs();
  closeHubDb();
}
