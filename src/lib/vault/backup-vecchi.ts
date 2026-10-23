/**
 * I backup che restano con la chiave vecchia dopo una ricifra (piano da-vault 2026-10-23, revisione del 23/10, rilievo 9).
 *
 * Dopo `ricifra --applica` i database vivi sono sulla chiave degli slot, ma i backup fatti PRIMA hanno ancora i valori
 * cifrati con `ENCRYPTION_KEY`: chi ha quella chiave (un file `.env.local` copiato, un'immagine della VM) li apre senza
 * passphrase né TPM. Qui si cercano e, solo su richiesta esplicita, si cancellano:
 * - `<dati>/hub.db.bak-*` e `<dati>/tenants/*.db.bak-*` (copie accanto ai database: pulizia credenziali, `togli-chiavi`);
 * - `<radice backup>/AAAA-MM-GG/hub.db.gz` e `…/tenants/*.db.gz` (backup notturno; la ritenzione li toglie da sola in 30
 *   giorni).
 *
 * Un backup «ha la chiave vecchia» se almeno un suo valore (fuori dai segreti dell'accesso, che restano sulla chiave
 * d'installazione per scelta, ADR 0034) si apre con la chiave data. I `.gz` si espandono in una cartella 0700 che si
 * toglie sempre. Mai valori nel rapporto: percorso, numero di valori, dimensione.
 *
 * Non si toccano le copie fuori da qui (snapshot di Proxmox, backup fuori sede): restano con la chiave vecchia e il
 * rapporto lo ricorda.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { apre, COLONNE_ESCLUSE, colonneDi, RE_CIFRATO } from "./ricifra";

export interface BackupVecchio {
  percorso: string;
  tipo: "bak" | "notturno";
  /** Valori che si aprono ancora con la chiave data (esclusi i segreti dell'accesso). */
  valori: number;
  byte: number;
}

export interface RapportoBackupVecchi {
  /** Backup con almeno un valore della chiave data. */
  conChiaveVecchia: BackupVecchio[];
  /** Quanti backup sono stati controllati in tutto. */
  controllati: number;
  /** Non controllabili (illeggibili, non SQLite): da guardare a mano. */
  nonVerificabili: Array<{ percorso: string; motivo: string }>;
}

const RE_BAK = /\.db\.bak-\d{8}-\d{6}$/;
const RE_GIORNO = /^\d{4}-\d{2}-\d{2}$/;

function candidati(dataDir: string, radiceBackup: string): Array<{ percorso: string; tipo: "bak" | "notturno" }> {
  const out: Array<{ percorso: string; tipo: "bak" | "notturno" }> = [];
  for (const cartella of [dataDir, join(dataDir, "tenants")]) {
    if (!existsSync(cartella)) continue;
    for (const n of readdirSync(cartella).sort()) {
      const p = join(cartella, n);
      if (RE_BAK.test(n) && statSync(p).isFile()) out.push({ percorso: p, tipo: "bak" });
    }
  }
  if (existsSync(radiceBackup)) {
    for (const giorno of readdirSync(radiceBackup).filter((n) => RE_GIORNO.test(n)).sort()) {
      const hub = join(radiceBackup, giorno, "hub.db.gz");
      if (existsSync(hub)) out.push({ percorso: hub, tipo: "notturno" });
      const cartellaTenant = join(radiceBackup, giorno, "tenants");
      if (existsSync(cartellaTenant)) {
        for (const n of readdirSync(cartellaTenant).filter((x) => x.endsWith(".db.gz")).sort()) out.push({ percorso: join(cartellaTenant, n), tipo: "notturno" });
      }
    }
  }
  return out;
}

/** Quanti valori di un database SQLite (aperto in sola lettura) si aprono con la chiave, fuori dai segreti dell'accesso. */
function contaValori(file: string, chiave: Buffer): number {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    let n = 0;
    for (const { tabella, colonna } of colonneDi(db)) {
      if (COLONNE_ESCLUSE.has(`${tabella}.${colonna}`)) continue;
      const t = `"${tabella.replace(/"/g, '""')}"`;
      const c = `"${colonna.replace(/"/g, '""')}"`;
      for (const { v } of db.prepare(`SELECT ${c} AS v FROM ${t} WHERE typeof(${c}) = 'text' AND ${c} LIKE '%:%:%'`).all() as Array<{ v: string }>) {
        for (const m of v.match(RE_CIFRATO) ?? []) if (apre(chiave, m)) n += 1;
      }
    }
    return n;
  } finally {
    db.close();
  }
}

async function valoriDelBackup(percorso: string, tipo: "bak" | "notturno", chiave: Buffer): Promise<number> {
  if (tipo === "bak") return contaValori(percorso, chiave);
  const cartella = mkdtempSync(join(tmpdir(), "da-vault-backup-"));
  try {
    const espanso = join(cartella, "backup.db");
    await pipeline(createReadStream(percorso), createGunzip(), createWriteStream(espanso, { mode: 0o600 }));
    return contaValori(espanso, chiave);
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

/** Cerca i backup che hanno ancora valori della chiave data (di norma: la chiave d'installazione, dopo la ricifra). */
export async function elencaBackupConChiave(op: { dataDir: string; radiceBackup: string; chiave: Buffer }): Promise<RapportoBackupVecchi> {
  const rapporto: RapportoBackupVecchi = { conChiaveVecchia: [], controllati: 0, nonVerificabili: [] };
  for (const c of candidati(op.dataDir, op.radiceBackup)) {
    try {
      const valori = await valoriDelBackup(c.percorso, c.tipo, op.chiave);
      rapporto.controllati += 1;
      if (valori > 0) rapporto.conChiaveVecchia.push({ percorso: c.percorso, tipo: c.tipo, valori, byte: statSync(c.percorso).size });
    } catch (e) {
      rapporto.nonVerificabili.push({ percorso: c.percorso, motivo: e instanceof Error ? e.message.slice(0, 200) : "errore" });
    }
  }
  return rapporto;
}

/** Cancella i backup dell'elenco (e i loro `-wal`/`-shm` accanto, se ci sono). Un errore su uno non ferma gli altri e si dice. */
export function purgaBackup(elenco: BackupVecchio[]): { cancellati: string[]; errori: Array<{ percorso: string; motivo: string }> } {
  const cancellati: string[] = [];
  const errori: Array<{ percorso: string; motivo: string }> = [];
  for (const b of elenco) {
    try {
      for (const p of [b.percorso, `${b.percorso}-wal`, `${b.percorso}-shm`]) rmSync(p, { force: true });
      cancellati.push(b.percorso);
    } catch (e) {
      errori.push({ percorso: b.percorso, motivo: e instanceof Error ? e.message.slice(0, 200) : "errore" });
    }
  }
  return { cancellati, errori };
}
