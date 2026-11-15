/**
 * L'archivio di un'installazione (piano di sicurezza 14/11, P0-4): database dell'hub, database dei clienti e file
 * delle chiavi in un file solo, cifrato verso la chiave di recupero (`cifratura.ts`). Con quel file e la busta si
 * ricostruisce l'installazione su una macchina pulita, senza Domarc e senza DA-Link.
 *
 * Non entrano: i registri su file (`data/logs`), le cache e gli asset che arrivano col programma.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { unisci } from "@/lib/percorsi";
import { cifraFile, decifraFile } from "./cifratura";

const NOME_CHIAVI = ".env.local";

function cartellaProvvisoria(): string {
  return fs.mkdtempSync(unisci(os.tmpdir(), "dainv-archivio-"));
}

/** Copia consistente di un database in uso (API di backup di SQLite): niente file a metà di una scrittura. */
async function copiaDatabase(origine: string, destinazione: string): Promise<void> {
  const db = new Database(origine, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destinazione);
  } finally {
    db.close();
  }
}

export async function creaArchivioCifrato(op: {
  dataDir: string;
  /** Il file delle chiavi dell'installazione; null se non va incluso. */
  fileChiavi: string | null;
  uscita: string;
  pubblica: string;
}): Promise<{ contenuto: string[]; impronta: string }> {
  const hub = unisci(op.dataDir, "hub.db");
  if (!fs.existsSync(hub)) throw new Error(`Database dell'installazione non trovato: ${hub}`);
  const lavoro = cartellaProvvisoria();
  try {
    const dentro = unisci(lavoro, "dentro");
    fs.mkdirSync(unisci(dentro, "tenants"), { recursive: true, mode: 0o700 });
    const contenuto: string[] = [];
    await copiaDatabase(hub, unisci(dentro, "hub.db"));
    contenuto.push("hub.db");
    const tenants = unisci(op.dataDir, "tenants");
    if (fs.existsSync(tenants)) {
      for (const f of fs.readdirSync(tenants).filter((n) => n.endsWith(".db")).sort()) {
        await copiaDatabase(unisci(tenants, f), unisci(dentro, "tenants", f));
        contenuto.push(`tenants/${f}`);
      }
    }
    if (op.fileChiavi) {
      if (!fs.existsSync(op.fileChiavi)) throw new Error(`File delle chiavi non trovato: ${op.fileChiavi}`);
      fs.copyFileSync(op.fileChiavi, unisci(dentro, NOME_CHIAVI));
      contenuto.push(NOME_CHIAVI);
    }
    const tar = unisci(lavoro, "archivio.tar");
    execFileSync("tar", ["-cf", tar, "-C", dentro, "."], { stdio: ["ignore", "ignore", "pipe"] });
    const { impronta } = cifraFile(tar, op.uscita, op.pubblica);
    return { contenuto, impronta };
  } finally {
    fs.rmSync(lavoro, { recursive: true, force: true });
  }
}

/**
 * Apre l'archivio in una cartella vuota (mai sopra un'installazione) e controlla ogni database con
 * `PRAGMA integrity_check`. Mettere poi i file al loro posto è un passo a parte, fatto a servizio fermo.
 */
export function ripristinaArchivio(op: { file: string; privata: string; destinazione: string }): { contenuto: string[]; creato: string } {
  if (fs.existsSync(op.destinazione) && fs.readdirSync(op.destinazione).length > 0) {
    throw new Error(`La cartella di destinazione non è vuota: ${op.destinazione}`);
  }
  const lavoro = cartellaProvvisoria();
  try {
    const tar = unisci(lavoro, "archivio.tar");
    const { creato } = decifraFile(op.file, tar, op.privata);
    const voci = execFileSync("tar", ["-tf", tar], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const v of voci) {
      if (path.isAbsolute(v) || v.split("/").includes("..")) throw new Error(`Archivio rifiutato: percorso non ammesso (${v})`);
    }
    fs.mkdirSync(op.destinazione, { recursive: true, mode: 0o700 });
    execFileSync("tar", ["-xf", tar, "-C", op.destinazione], { stdio: ["ignore", "ignore", "pipe"] });
    const contenuto = voci.map((v) => v.replace(/^\.\//, "")).filter((v) => v && v !== "." && !v.endsWith("/"));
    for (const v of contenuto.filter((n) => n.endsWith(".db"))) {
      const db = new Database(unisci(op.destinazione, v), { readonly: true, fileMustExist: true });
      try {
        const esito = db.pragma("integrity_check", { simple: true });
        if (esito !== "ok") throw new Error(`Database rovinato nel backup: ${v} (${String(esito)})`);
      } finally {
        db.close();
      }
    }
    return { contenuto, creato };
  } catch (e) {
    // Un ripristino a metà non resta lì a sembrare buono.
    fs.rmSync(op.destinazione, { recursive: true, force: true });
    throw e;
  } finally {
    fs.rmSync(lavoro, { recursive: true, force: true });
  }
}
