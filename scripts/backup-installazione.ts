/**
 * Backup cifrato dell'installazione e ripristino (piano di sicurezza 14/11, P0-4). Si lancia sul server, nella
 * cartella dell'app:
 *
 *   npx tsx scripts/backup-installazione.ts chiavi [--rigenera]     # una volta: stampa la chiave per la busta
 *   npx tsx scripts/backup-installazione.ts impronta                # quale chiave apre i backup di qui
 *   npx tsx scripts/backup-installazione.ts crea [file]             # database + file delle chiavi, cifrati
 *   npx tsx scripts/backup-installazione.ts ripristina <file> <cartella vuota>   # chiave della busta dallo stdin
 *
 * Sull'appliance resta solo la chiave pubblica (`backup-recupero.pub`, accanto al file delle chiavi): cifra ma
 * non apre. La privata si vede una volta, da `chiavi`, e va in busta. `ripristina` scrive in una cartella vuota e
 * non tocca mai l'installazione viva.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../src/lib/data-dir";
import { resolveEnvSecretsPath } from "../src/lib/env-secrets";
import { generaChiaviRecupero, improntaChiave } from "../src/lib/backup-installazione/cifratura";
import { creaArchivioCifrato, ripristinaArchivio } from "../src/lib/backup-installazione/archivio";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

const filePubblica = (): string => path.join(path.dirname(resolveEnvSecretsPath()), "backup-recupero.pub");

function leggiPubblica(): string {
  const f = filePubblica();
  if (!fs.existsSync(f)) esci(`Nessuna chiave di recupero su questa installazione (${f}). Prima: npx tsx scripts/backup-installazione.ts chiavi`);
  return fs.readFileSync(f, "utf8").trim();
}

async function main(): Promise<void> {
  const [comando, ...resto] = process.argv.slice(2);
  if (comando === "chiavi") {
    const f = filePubblica();
    if (fs.existsSync(f) && !resto.includes("--rigenera")) {
      esci(`Una chiave di recupero c'è già (${improntaChiave(fs.readFileSync(f, "utf8"))}). Con --rigenera se ne fa una nuova: i backup vecchi si aprono solo con la busta vecchia.`);
    }
    const k = generaChiaviRecupero();
    fs.writeFileSync(f, `${k.pubblica}\n`, { mode: 0o600 });
    console.log(`Chiave di recupero ${k.impronta}. Stampala e chiudila in busta: non viene salvata e non si rivede.\n`);
    console.log(k.privata);
    console.log(`\nSul foglio scrivi anche l'impronta: ${k.impronta}`);
    return;
  }
  if (comando === "impronta") {
    console.log(improntaChiave(leggiPubblica()));
    return;
  }
  if (comando === "crea") {
    const pubblica = leggiPubblica();
    const quando = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const uscita = path.resolve(resto[0] ?? path.join(resolveDataDir(), "backups", `installazione-${quando}.dainv`));
    fs.mkdirSync(path.dirname(uscita), { recursive: true });
    const chiavi = resolveEnvSecretsPath();
    const e = await creaArchivioCifrato({ dataDir: resolveDataDir(), fileChiavi: fs.existsSync(chiavi) ? chiavi : null, uscita, pubblica });
    console.log(`Backup cifrato: ${uscita}`);
    console.log(`Si apre con la chiave ${e.impronta}. Dentro: ${e.contenuto.join(", ")}`);
    if (!e.contenuto.includes(".env.local")) console.log("ATTENZIONE: il file delle chiavi non c'era e non è nel backup: i segreti nel database non si potranno leggere.");
    return;
  }
  if (comando === "ripristina" && resto.length === 2) {
    if (process.stdin.isTTY) console.error("Scrivi la chiave della busta e premi Invio, poi Ctrl-D:");
    // Lettura asincrona: `readFileSync(0)` su una pipe non bloccante di Linux dà EAGAIN (prova del 15/11 su Debian).
    const pezzi: Buffer[] = [];
    for await (const p of process.stdin) pezzi.push(Buffer.from(p));
    const privata = Buffer.concat(pezzi).toString("utf8");
    const r = ripristinaArchivio({ file: path.resolve(resto[0]), privata, destinazione: path.resolve(resto[1]) });
    console.log(`Ripristinato in ${path.resolve(resto[1])} il backup del ${r.creato}: ${r.contenuto.join(", ")}`);
    console.log("Ogni database ha passato il controllo di integrità. A servizio fermo: hub.db e tenants/ nella cartella dei dati, .env.local al suo posto.");
    return;
  }
  esci("Uso: npx tsx scripts/backup-installazione.ts chiavi [--rigenera] | impronta | crea [file] | ripristina <file> <cartella vuota>");
}

main().catch((e) => esci(e instanceof Error ? e.message : String(e)));
