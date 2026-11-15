/**
 * Backup unificato col vault locale (piano di sicurezza; Riccardo, 15/11/2026: «una passphrase sola»).
 *
 * La coppia di chiavi dei backup nasce la prima volta che il vault è aperto. La **privata** sta dentro il vault
 * (`segreti.json`, cifrata con la chiave degli slot): la raggiunge chi apre uno slot, cioè il cliente con la sua
 * passphrase o Domarc con la chiave di recupero. Non c'è una busta a parte. La **pubblica** sta in chiaro accanto
 * all'archivio (`backup.pub`): il backup notturno cifra anche a vault bloccato.
 *
 * La cartella del giorno, dopo la cifratura, contiene solo `installazione.dainv` (database e file delle chiavi) e
 * `vault/` (l'archivio, già cifrato dagli slot). Per ripristinare: si apre `vault/` con la passphrase, da lì esce la
 * chiave privata, e con quella si apre il resto.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { scriviAtomico } from "@/lib/vault/archivio";
import { LocaleStore } from "@/lib/vault/locale";
import { ErroreVault } from "@/lib/vault/tipi";
import { unisci } from "@/lib/percorsi";
import { cifraFile, decifraFile, generaChiaviRecupero, improntaChiave } from "./cifratura";

export const PERCORSO_CHIAVE_BACKUP = "app/da-ipam/backup/chiave-privata";
export const FILE_PUBBLICA_BACKUP = "backup.pub";
export const FILE_BACKUP_CIFRATO = "installazione.dainv";
const NOME_CHIAVI = ".env.local";

/**
 * La chiave pubblica dei backup; null se non è mai stata generata e il vault è bloccato. Col vault aperto controlla
 * che la privata custodita sia quella della pubblica su disco: se non lo è (archivio ricreato, file copiato) ne
 * genera una coppia nuova, perché un backup cifrato verso una chiave che nessuno ha non si apre più.
 */
export async function chiavePubblicaBackup(dirVault: string, chiaveDati: () => Buffer | null): Promise<string | null> {
  const filePub = unisci(dirVault, FILE_PUBBLICA_BACKUP);
  const suDisco = fs.existsSync(filePub) ? fs.readFileSync(filePub, "utf8").trim() : null;
  if (chiaveDati() === null) return suDisco;
  const store = new LocaleStore({ dir: dirVault, chiave: chiaveDati });
  let privata: string | null = null;
  try {
    privata = (await store.get(PERCORSO_CHIAVE_BACKUP)).privata ?? null;
  } catch (e) {
    if (!(e instanceof ErroreVault) || e.codice !== "non_trovato") throw e;
  }
  if (suDisco && privata && improntaChiave(privata) === improntaChiave(suDisco)) return suDisco;
  const k = generaChiaviRecupero();
  await store.put(PERCORSO_CHIAVE_BACKUP, { privata: k.privata, impronta: k.impronta, creata: new Date().toISOString() });
  scriviAtomico(dirVault, FILE_PUBBLICA_BACKUP, `${k.pubblica}\n`);
  return k.pubblica;
}

function elenca(cartella: string, sotto = ""): string[] {
  const voci: string[] = [];
  for (const n of fs.readdirSync(unisci(cartella, sotto)).sort()) {
    const rel = sotto ? `${sotto}/${n}` : n;
    if (fs.statSync(unisci(cartella, rel)).isDirectory()) voci.push(...elenca(cartella, rel));
    else voci.push(rel);
  }
  return voci;
}

/**
 * Cifra la cartella del backup del giorno: tutto tranne `vault/` e `manifest.json` entra in `installazione.dainv`,
 * insieme al file delle chiavi, e gli originali in chiaro si tolgono solo a file cifrato scritto.
 */
export async function cifraCartellaBackup(op: { cartella: string; pubblica: string; fileChiavi: string | null }): Promise<{ file: string; impronta: string; dentro: string[] }> {
  const fuori = new Set(["vault", "manifest.json", FILE_BACKUP_CIFRATO]);
  const radici = fs.readdirSync(op.cartella).filter((n) => !fuori.has(n) && !n.endsWith(".parziale")).sort();
  const copiaChiavi = unisci(op.cartella, NOME_CHIAVI);
  const lavoro = fs.mkdtempSync(unisci(os.tmpdir(), "dainv-cifra-"));
  try {
    if (op.fileChiavi && fs.existsSync(op.fileChiavi)) {
      fs.copyFileSync(op.fileChiavi, copiaChiavi);
      fs.chmodSync(copiaChiavi, 0o600);
      if (!radici.includes(NOME_CHIAVI)) radici.push(NOME_CHIAVI);
    }
    if (radici.length === 0) throw new Error(`Niente da cifrare in ${op.cartella}`);
    const dentro = radici.flatMap((r) => (fs.statSync(unisci(op.cartella, r)).isDirectory() ? elenca(op.cartella, r) : [r]));
    const tar = unisci(lavoro, "archivio.tar");
    execFileSync("tar", ["-cf", tar, "-C", op.cartella, ...radici], { stdio: ["ignore", "ignore", "pipe"] });
    const file = unisci(op.cartella, FILE_BACKUP_CIFRATO);
    const { impronta } = cifraFile(tar, file, op.pubblica);
    for (const r of radici) fs.rmSync(unisci(op.cartella, r), { recursive: true, force: true });
    return { file, impronta, dentro };
  } finally {
    fs.rmSync(copiaChiavi, { force: true });
    fs.rmSync(lavoro, { recursive: true, force: true });
  }
}

/**
 * Ripristina il backup di un giorno in una cartella vuota. `apri` apre l'archivio del vault che sta nel backup
 * (`apriConPassphrase` per il cliente, `apriConDomarc` per il recupero) e rende la chiave degli slot.
 * I database tornano decompressi e controllati; l'archivio del vault torna in `vault/`.
 */
export async function ripristinaBackupDelGiorno(op: {
  cartella: string;
  apri: (dirVault: string) => Promise<Buffer>;
  destinazione: string;
}): Promise<{ contenuto: string[]; creato: string }> {
  if (fs.existsSync(op.destinazione) && fs.readdirSync(op.destinazione).length > 0) {
    throw new Error(`La cartella di destinazione non è vuota: ${op.destinazione}`);
  }
  const vaultDelBackup = unisci(op.cartella, "vault");
  const cifrato = unisci(op.cartella, FILE_BACKUP_CIFRATO);
  if (!fs.existsSync(cifrato)) throw new Error(`In ${op.cartella} non c'è ${FILE_BACKUP_CIFRATO}: non è un backup cifrato`);
  if (!fs.existsSync(unisci(vaultDelBackup, "archivio.json"))) throw new Error(`In ${op.cartella} manca l'archivio del vault: senza, il backup non si apre`);
  const chiave = await op.apri(vaultDelBackup);
  const privata = (await new LocaleStore({ dir: vaultDelBackup, chiave: () => chiave }).get(PERCORSO_CHIAVE_BACKUP)).privata;
  if (!privata) throw new Error("Nel vault del backup non c'è la chiave dei backup");
  const lavoro = fs.mkdtempSync(unisci(os.tmpdir(), "dainv-ripristino-"));
  try {
    const tar = unisci(lavoro, "archivio.tar");
    const { creato } = decifraFile(cifrato, tar, privata);
    const voci = execFileSync("tar", ["-tf", tar], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const v of voci) {
      if (path.isAbsolute(v) || v.split("/").includes("..")) throw new Error(`Archivio rifiutato: percorso non ammesso (${v})`);
    }
    fs.mkdirSync(op.destinazione, { recursive: true, mode: 0o700 });
    execFileSync("tar", ["-xf", tar, "-C", op.destinazione], { stdio: ["ignore", "ignore", "pipe"] });
    const contenuto: string[] = [];
    for (const v of elenca(op.destinazione)) {
      if (!v.endsWith(".db.gz")) {
        contenuto.push(v);
        continue;
      }
      const db = v.slice(0, -3);
      fs.writeFileSync(unisci(op.destinazione, db), zlib.gunzipSync(fs.readFileSync(unisci(op.destinazione, v))), { mode: 0o600 });
      fs.rmSync(unisci(op.destinazione, v));
      const d = new Database(unisci(op.destinazione, db), { readonly: true, fileMustExist: true });
      try {
        const esito = d.pragma("integrity_check", { simple: true });
        if (esito !== "ok") throw new Error(`Database rovinato nel backup: ${db} (${String(esito)})`);
      } finally {
        d.close();
      }
      contenuto.push(db);
    }
    fs.cpSync(vaultDelBackup, unisci(op.destinazione, "vault"), { recursive: true });
    return { contenuto, creato };
  } catch (e) {
    fs.rmSync(op.destinazione, { recursive: true, force: true });
    throw e;
  } finally {
    fs.rmSync(lavoro, { recursive: true, force: true });
  }
}
