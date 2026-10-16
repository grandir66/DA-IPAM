// src/lib/transfer/import.ts
import zlib from "zlib";
import type Database from "better-sqlite3";
import type { ImportOptions, ImportResult } from "./types";
import { readContainer, deriveTransportKey, decryptBuffer, decryptFieldWithKey } from "./envelope";
import { tableSpec, TENANT_TABLES } from "./table-registry";
import { writableColumns, rekeyColumns } from "./schema-introspect";
import { encrypt } from "@/lib/crypto";
import { descriviNormalizza, normalizzaTipiCredenziali, segnoTipi } from "@/lib/credentials/normalizza-tipi";
import { scriviSegno, segnoErrore, SEGNO_CATENE, SEGNO_TIPI } from "@/lib/credentials/segni-t2";
import { convertiCateneVecchie, descriviCatene, segnoCatene } from "@/lib/credentials/converti-catene";

export interface ImportArgs {
  bundle: Buffer;
  tenantDb: Database.Database;
  hubDb: Database.Database;
  options: ImportOptions;
}

interface PayloadLine { tbl: string; row: Record<string, unknown> }

export function importTenant(args: ImportArgs): ImportResult {
  const { bundle, tenantDb, hubDb, options } = args;
  const { manifest, encryptedPayload } = readContainer(bundle);

  const salt = Buffer.from(manifest.encryption.saltHex, "hex");
  const transportKey = deriveTransportKey(options.passphrase, salt);

  // Decifra + decomprimi (chiave sbagliata → GCM throw qui)
  let payloadPlain: Buffer;
  try {
    payloadPlain = zlib.gunzipSync(decryptBuffer(encryptedPayload, transportKey));
  } catch {
    throw new Error("Passphrase errata o bundle corrotto");
  }

  const lines = payloadPlain.length
    ? payloadPlain.toString("utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as PayloadLine)
    : [];

  // Raggruppa righe per tabella
  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const { tbl, row } of lines) {
    if (!byTable.has(tbl)) byTable.set(tbl, []);
    byTable.get(tbl)!.push(row);
  }

  const result: ImportResult = { tables: {}, profilesMerged: 0, vaultMerged: 0, rekeyedSecrets: 0, fkViolations: 0, conversioni: {} };

  // --- Import tabelle TENANT (replace) in un'unica transazione ---
  // PRAGMA foreign_keys è no-op dentro una transazione aperta: il toggle va FUORI
  tenantDb.pragma("foreign_keys = OFF");
  try {
    const tenantTx = tenantDb.transaction(() => {
      if (options.wipe) {
        for (const spec of [...TENANT_TABLES].reverse()) {
          if (tableExists(tenantDb, spec.table)) tenantDb.prepare(`DELETE FROM "${spec.table}"`).run();
        }
      }

      for (const [tbl, rows] of byTable) {
        const spec = tableSpec(tbl);
        if (!spec || spec.scope !== "tenant") continue;
        if (!tableExists(tenantDb, tbl)) continue; // target più vecchio: salta tabella sconosciuta
        result.tables[tbl] = insertRows(tenantDb, tbl, spec.dedupe ? dedupeRows(rows, spec.dedupe) : rows, transportKey, result);
      }

      const fk = tenantDb.pragma("foreign_key_check") as unknown[];
      result.fkViolations = fk.length;            // pre-existing orphans, reproduced faithfully — NOT fatal
      if (fk.length > 0) console.warn(`[transfer] import: ${fk.length} riferimenti FK orfani preservati (come nella sorgente)`);
      const integ = tenantDb.pragma("integrity_check", { simple: true });
      if (integ !== "ok") throw new Error(`integrity_check: ${integ}`);
    });
    tenantTx();
  } finally {
    tenantDb.pragma("foreign_keys = ON");
  }

  // Tappa 2c credenziali (T11): il bundle può venire da prima della 2c (voci
  // `linux`, `snmp` col livello SNMPv3), e un import con cancellazione ha
  // sostituito tenant_settings col contenuto del bundle, segni compresi. Qui la
  // normalizzazione si chiama direttamente, senza guardare il segno (i dati sono
  // quelli del bundle, o quelli uniti), e il segno si riscrive con l'esito, che
  // va anche nella risposta: con un'unione quello che cambia non passa in
  // silenzio. Se fallisce i dati restano importati, il segno dice errore: e la
  // conversione si riprova alla prossima apertura del tenant.
  try {
    const esito = normalizzaTipiCredenziali(tenantDb);
    const segno = segnoTipi(esito);
    scriviSegno(tenantDb, SEGNO_TIPI, segno);
    result.conversioni[SEGNO_TIPI] = { segno, dettaglio: descriviNormalizza(esito) };
  } catch (e) {
    console.error(`[transfer] import: ${SEGNO_TIPI} fallita, si riprova alla prossima apertura del tenant:`, e);
    const segno = segnoErrore(e);
    try {
      scriviSegno(tenantDb, SEGNO_TIPI, segno);
    } catch (e2) {
      console.error(`[transfer] import: ${SEGNO_TIPI}, segno d'errore non scritto:`, e2);
    }
    result.conversioni[SEGNO_TIPI] = { segno, dettaglio: "normalizzazione dei tipi delle credenziali non eseguita" };
  }

  // Tappa 2d credenziali (T16): il bundle può portare catene vecchie e pin, e
  // il segno della sorgente. Come sopra: la conversione si chiama direttamente,
  // senza chiavi dell'hub (globali = null: sono id del DB di un tenant salvati
  // nell'hub, e quelli di questa installazione non dicono niente sul bundle),
  // e il segno si riscrive con l'esito, nella stessa transazione.
  try {
    const { esito, segno } = tenantDb.transaction(() => {
      const esito = convertiCateneVecchie(tenantDb, null, { aVuoto: false });
      const segno = segnoCatene(esito);
      scriviSegno(tenantDb, SEGNO_CATENE, segno);
      return { esito, segno };
    })();
    result.conversioni[SEGNO_CATENE] = { segno, dettaglio: descriviCatene(esito) };
  } catch (e) {
    console.error(`[transfer] import: ${SEGNO_CATENE} fallita, si riprova alla prossima apertura del tenant:`, e);
    const segno = segnoErrore(e);
    try {
      scriviSegno(tenantDb, SEGNO_CATENE, segno);
    } catch (e2) {
      console.error(`[transfer] import: ${SEGNO_CATENE}, segno d'errore non scritto:`, e2);
    }
    result.conversioni[SEGNO_CATENE] = { segno, dettaglio: "conversione delle catene vecchie e dei pin non eseguita" };
  }

  // --- Import tabelle HUB (merge, non distruttivo) ---
  const hubTx = hubDb.transaction(() => {
    for (const [tbl, rows] of byTable) {
      const spec = tableSpec(tbl);
      if (!spec || spec.scope === "tenant") continue;
      if (!tableExists(hubDb, tbl)) continue;

      if (spec.scope === "hub-tenant" && spec.tenantColumn) {
        // riallinea il codice tenant a quello di destinazione
        for (const row of rows) row[spec.tenantColumn] = options.tenantCode;
      }

      if (spec.mergeKey) {
        const merged = mergeRows(hubDb, tbl, rows, spec.mergeKey, transportKey, result);
        if (spec.scope === "hub-vault") result.vaultMerged += merged;
        else if (spec.scope === "hub-global") result.profilesMerged += merged;
        result.tables[tbl] = merged;
      } else {
        result.tables[tbl] = insertRows(hubDb, tbl, rows, transportKey, result);
      }
    }
  });
  hubTx();

  return result;
}

/** Una riga per chiave: quella col `latest` più recente, a parità l'id più alto (come la migrazione che ha messo l'indice). */
function dedupeRows(
  rows: Record<string, unknown>[], spec: { key: string[]; latest: string },
): Record<string, unknown>[] {
  const keep = new Map<string, Record<string, unknown>>();
  const order = (r: Record<string, unknown>): [string, number] => [String(r[spec.latest] ?? ""), Number(r.id ?? 0)];
  for (const r of rows) {
    const k = JSON.stringify(spec.key.map((c) => r[c] ?? null));
    const cur = keep.get(k);
    if (!cur) { keep.set(k, r); continue; }
    const [ts, id] = order(r), [cts, cid] = order(cur);
    if (ts > cts || (ts === cts && id > cid)) keep.set(k, r);
  }
  return [...keep.values()];
}

/** INSERT righe, re-keyando i campi cifrati (transport key → chiave destinazione). */
function insertRows(
  db: Database.Database, table: string, rows: Record<string, unknown>[],
  transportKey: Buffer, result: ImportResult,
): number {
  if (rows.length === 0) return 0;
  const targetCols = new Set(writableColumns(db, table));
  const spec = tableSpec(table);
  const rekeys = new Set([
    ...rekeyColumns(db, table),
    ...((spec?.secretColumns ?? []).filter((c) => targetCols.has(c))),
  ]);
  let n = 0;
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => targetCols.has(c));
    if (cols.length === 0) continue;
    const values = cols.map((c) => rekeyValue(row[c], rekeys.has(c), transportKey, result));
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    db.prepare(sql).run(...values);
    n++;
  }
  return n;
}

/** Merge-by-key: salta le righe già presenti (idempotente per profili/vault). */
function mergeRows(
  db: Database.Database, table: string, rows: Record<string, unknown>[],
  mergeKey: string[], transportKey: Buffer, result: ImportResult,
): number {
  if (rows.length === 0) return 0;
  const targetCols = new Set(writableColumns(db, table));
  const spec = tableSpec(table);
  const rekeys = new Set([
    ...rekeyColumns(db, table),
    ...((spec?.secretColumns ?? []).filter((c) => targetCols.has(c))),
  ]);
  const where = mergeKey.map((k) => `"${k}" = ?`).join(" AND ");
  const exists = db.prepare(`SELECT 1 FROM "${table}" WHERE ${where} LIMIT 1`);
  let n = 0;
  for (const row of rows) {
    const keyVals = mergeKey.map((k) => row[k] as unknown);
    if (exists.get(...keyVals)) continue; // già presente → non duplicare
    const cols = Object.keys(row).filter((c) => targetCols.has(c));
    const values = cols.map((c) => rekeyValue(row[c], rekeys.has(c), transportKey, result));
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    db.prepare(sql).run(...values);
    n++;
  }
  return n;
}

function rekeyValue(v: unknown, isSecret: boolean, transportKey: Buffer, result: ImportResult): unknown {
  if (!isSecret || typeof v !== "string" || v.length === 0) return v;
  const pt = decryptFieldWithKey(v, transportKey); // transport → plaintext
  result.rekeyedSecrets++;
  return encrypt(pt); // plaintext → chiave d'installazione destinazione
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
}
