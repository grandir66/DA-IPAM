/**
 * La ricifra (piano da-vault 2026-10-23, passo 10): dalla chiave di `ENCRYPTION_KEY` alla chiave dei dati degli slot.
 *
 * Cosa prende: ogni valore nel formato di `encrypt()` (`iv:tag:testo` in esadecimale), intero o dentro un testo (le
 * configurazioni JSON di network-services e inventory-agent), in ogni tabella di `hub.db` e dei database dei clienti,
 * che si apre con la chiave d'installazione. Così passano dalla chiave degli slot tutti gli `encrypt()` dell'app
 * (credenziali e binding, integrazioni, profili edge di vuln, inventory-agent, network-services, credenziali di
 * sistema) senza un elenco da tenere allineato. Restano fuori, apposta, i segreti dell'accesso (`users.totp_*`,
 * ADR 0034). Un valore che non si apre con la chiave d'installazione (già ricifrato, o rotto) non si tocca.
 *
 * Come:
 * - **prova a vuoto di default**: la transazione si fa e si annulla; il rapporto dice quanti valori per colonna;
 * - **tutto o niente**: prima una prova a vuoto su TUTTI i database, poi un database alla volta, ognuno in una
 *   transazione (`BEGIN IMMEDIATE`). Un crash a metà lascia ogni database com'era o tutto ricifrato, e ogni valore
 *   resta leggibile (`decrypt()` prova le due chiavi): si ripete e finisce;
 * - **verificata sopra il lettore unico**: dentro la transazione, ogni voce di `credentials` deve dare con
 *   `campiVoceDb` gli stessi campi di prima, e non deve restare nessun valore della chiave vecchia; altrimenti
 *   ROLLBACK;
 * - dopo il commit `wal_checkpoint(TRUNCATE)` e `VACUUM`: i valori vecchi non restano nelle pagine libere.
 *
 * Il rapporto non contiene mai valori, né in chiaro né cifrati. Condizioni: `DA_VAULT_LOCALE=1` e la chiave degli
 * slot già aperta in questo processo (è la stessa che userà l'app).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chiaveInstallazione, cifraConChiave, decifraConChiave } from "@/lib/crypto";
import { campiVoceDb } from "@/lib/credentials/segreti";
import { chiaveDatiAttiva, vaultLocaleAcceso } from "./stato";

/** Colonne che restano sulla chiave d'installazione: col vault bloccato si deve poter entrare (ADR 0034). */
export const COLONNE_ESCLUSE: ReadonlySet<string> = new Set(["users.totp_segreto", "users.totp_proposto"]);

const RE_CIFRATO = /(?<![0-9a-f])[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*/g;
const NOME_TENANT = /^[A-Za-z0-9_-]+\.db$/;

export interface EsitoFile {
  file: string;
  /** «tabella.colonna» → valori ricifrati. */
  perColonna: Record<string, number>;
  valori: number;
  /** Voci di `credentials` controllate col lettore unico. */
  vociVerificate: number;
  /** Voci che già prima non si leggevano (non toccate, da guardare a parte). */
  vociIllegibili: number;
  vacuum: boolean;
}

export interface EsitoRicifra {
  applicata: boolean;
  file: EsitoFile[];
  totale: number;
}

export interface OpzioniRicifra {
  /** La cartella dei dati: `hub.db` e `tenants/*.db`. */
  dataDir: string;
  /** La chiave degli slot: deve essere quella aperta nel processo. */
  chiaveNuova: Buffer;
  /** false (di serie) = prova a vuoto. */
  applica?: boolean;
  /** Chiamata dopo ogni valore scritto (contatore globale): per le prove del guasto e del crash. */
  alPasso?: (n: number) => void;
}

/** I database da ricifrare: `hub.db` e i database dei clienti (non i file vuoti né i nomi strani). */
export function fileDaRicifrare(dataDir: string): string[] {
  const out: string[] = [];
  const hub = join(dataDir, "hub.db");
  if (existsSync(hub) && statSync(hub).size > 0) out.push(hub);
  const cartella = join(dataDir, "tenants");
  if (existsSync(cartella)) {
    for (const n of readdirSync(cartella).sort()) {
      const p = join(cartella, n);
      if (NOME_TENANT.test(n) && statSync(p).isFile() && statSync(p).size > 0) out.push(p);
    }
  }
  return out;
}

class Annulla extends Error {}

function apre(chiave: Buffer, v: string): boolean {
  try {
    decifraConChiave(chiave, v);
    return true;
  } catch {
    return false;
  }
}

function colonneDi(db: Database.Database): Array<{ tabella: string; colonna: string }> {
  const tabelle = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string; sql: string | null }>;
  const out: Array<{ tabella: string; colonna: string }> = [];
  for (const t of tabelle) {
    if (t.sql && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql)) continue;
    for (const c of db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all() as Array<{ name: string }>) {
      out.push({ tabella: t.name, colonna: c.name });
    }
  }
  return out;
}

/** I campi di tutte le voci, come li dà il lettore unico (per il confronto prima/dopo). */
function fotografiaVoci(db: Database.Database): { testo: string; voci: number; illegibili: number } {
  const ids = (db.prepare("SELECT id FROM credentials ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
  const esiti = ids.map((id) => campiVoceDb(db, id));
  return { testo: JSON.stringify(esiti), voci: ids.length, illegibili: esiti.filter((e) => !e.ok).length };
}

function ricifraFile(
  file: string,
  vecchia: Buffer,
  nuova: Buffer,
  applica: boolean,
  passo: { n: number; alPasso?: (n: number) => void },
): EsitoFile {
  const esito: EsitoFile = { file, perColonna: {}, valori: 0, vociVerificate: 0, vociIllegibili: 0, vacuum: false };
  const db = new Database(file);
  try {
    db.pragma("busy_timeout = 15000");
    const colonne = colonneDi(db);
    const haCredenziali = colonne.some((c) => c.tabella === "credentials");
    try {
      db.transaction(() => {
        const prima = haCredenziali ? fotografiaVoci(db) : null;
        for (const { tabella, colonna } of colonne) {
          const chiave = `${tabella}.${colonna}`;
          if (COLONNE_ESCLUSE.has(chiave)) continue;
          const t = `"${tabella.replace(/"/g, '""')}"`;
          const c = `"${colonna.replace(/"/g, '""')}"`;
          const righe = db
            .prepare(`SELECT rowid AS r, ${c} AS v FROM ${t} WHERE typeof(${c}) = 'text' AND ${c} LIKE '%:%:%'`)
            .all() as Array<{ r: number; v: string }>;
          const aggiorna = db.prepare(`UPDATE ${t} SET ${c} = ? WHERE rowid = ?`);
          for (const { r, v } of righe) {
            let n = 0;
            const nuovo = v.replace(RE_CIFRATO, (m) => {
              let chiaro: string;
              try {
                chiaro = decifraConChiave(vecchia, m);
              } catch {
                return m;
              }
              n += 1;
              return cifraConChiave(nuova, chiaro);
            });
            if (n === 0) continue;
            aggiorna.run(nuovo, r);
            esito.perColonna[chiave] = (esito.perColonna[chiave] ?? 0) + n;
            esito.valori += n;
            passo.n += 1;
            passo.alPasso?.(passo.n);
          }
          // Nessun valore della chiave vecchia rimasto in questa colonna.
          const rimasti = (db.prepare(`SELECT ${c} AS v FROM ${t} WHERE typeof(${c}) = 'text' AND ${c} LIKE '%:%:%'`).all() as Array<{ v: string }>)
            .some(({ v }) => (v.match(RE_CIFRATO) ?? []).some((m) => apre(vecchia, m)));
          if (rimasti) throw new Error(`Ricifra non riuscita: in ${chiave} resta un valore della chiave d'installazione`);
        }
        if (prima) {
          const dopo = fotografiaVoci(db);
          if (dopo.testo !== prima.testo) {
            throw new Error("Ricifra non riuscita: il lettore unico non dà più gli stessi campi per le credenziali (annullata)");
          }
          esito.vociVerificate = dopo.voci;
          esito.vociIllegibili = dopo.illegibili;
        }
        if (!applica) throw new Annulla();
      }).immediate();
    } catch (e) {
      if (!(e instanceof Annulla)) throw e;
    }
    if (applica && esito.valori > 0) {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.exec("VACUUM");
      db.pragma("wal_checkpoint(TRUNCATE)");
      esito.vacuum = true;
    } else if (applica) {
      esito.vacuum = true;
    }
  } finally {
    db.close();
  }
  return esito;
}

export function ricifra(op: OpzioniRicifra): EsitoRicifra {
  if (!vaultLocaleAcceso()) {
    throw new Error("La ricifra vuole DA_VAULT_LOCALE=1: con l'interruttore spento l'app non leggerebbe i valori ricifrati");
  }
  const aperta = chiaveDatiAttiva();
  if (!aperta || !aperta.equals(op.chiaveNuova)) {
    throw new Error("La chiave data non è quella aperta dagli slot in questo processo: ricifra rifiutata");
  }
  const vecchia = chiaveInstallazione();
  const file = fileDaRicifrare(op.dataDir);
  const applica = op.applica === true;

  // Tutto o niente: prima la prova a vuoto su tutti; si scrive solo se nessuno fallisce.
  const passo = { n: 0, alPasso: op.alPasso };
  const prova = file.map((f) => ricifraFile(f, vecchia, op.chiaveNuova, false, applica ? { n: 0 } : passo));
  if (!applica) return { applicata: false, file: prova, totale: prova.reduce((s, f) => s + f.valori, 0) };

  const fatti = file.map((f) => ricifraFile(f, vecchia, op.chiaveNuova, true, passo));
  return { applicata: true, file: fatti, totale: fatti.reduce((s, f) => s + f.valori, 0) };
}
