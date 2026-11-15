/**
 * Ripristino del backup cifrato dell'installazione (piano di sicurezza; Riccardo, 15/11/2026: una passphrase sola).
 * Il backup lo fa il motore notturno (`src/lib/backup/engine.ts`): col vault acceso ogni cartella del giorno
 * contiene `installazione.dainv` (database e file delle chiavi, cifrati) e `vault/` (l'archivio degli slot).
 *
 *   npx tsx scripts/backup-installazione.ts ripristina <cartella del giorno> <cartella vuota>            # passphrase del cliente dallo stdin
 *   npx tsx scripts/backup-installazione.ts ripristina <cartella del giorno> <cartella vuota> --domarc   # chiave Domarc dallo stdin
 *
 * Scrive in una cartella vuota e non tocca mai l'installazione viva. Il segreto si legge solo dallo stdin: come
 * argomento resterebbe nella storia della shell.
 */
import path from "node:path";
import { apriConDomarc, apriConPassphrase } from "../src/lib/vault/archivio";
import { ripristinaBackupDelGiorno } from "../src/lib/backup-installazione/col-vault";

function esci(messaggio: string, codice = 1): never {
  console.error(messaggio);
  process.exit(codice);
}

async function main(): Promise<void> {
  const argomenti = process.argv.slice(2);
  const domarc = argomenti.includes("--domarc");
  const [comando, cartella, destinazione] = argomenti.filter((a) => a !== "--domarc");
  if (comando !== "ripristina" || !cartella || !destinazione) {
    esci("Uso: npx tsx scripts/backup-installazione.ts ripristina <cartella del giorno> <cartella vuota> [--domarc]");
  }
  if (process.stdin.isTTY) console.error(domarc ? "Incolla la chiave Domarc e premi Invio, poi Ctrl-D:" : "Scrivi la passphrase del cliente e premi Invio, poi Ctrl-D:");
  // Lettura asincrona: `readFileSync(0)` su una pipe non bloccante di Linux dà EAGAIN (prova del 15/11 su Debian).
  const pezzi: Buffer[] = [];
  for await (const p of process.stdin) pezzi.push(Buffer.from(p));
  const segreto = Buffer.concat(pezzi).toString("utf8").replace(/\r?\n$/, "");
  if (!segreto) esci("Nessun segreto sullo stdin");
  const dove = path.resolve(destinazione);
  const r = await ripristinaBackupDelGiorno({
    cartella: path.resolve(cartella),
    apri: (dir) => (domarc ? apriConDomarc(dir, segreto.trim()) : apriConPassphrase(dir, segreto)),
    destinazione: dove,
  });
  console.log(`Ripristinato in ${dove} il backup del ${r.creato}: ${r.contenuto.join(", ")}, vault/`);
  console.log("Ogni database ha passato il controllo di integrità. A servizio fermo: hub.db, tenants/ e vault/ nella cartella dei dati, .env.local al suo posto.");
}

main().catch((e) => esci(e instanceof Error ? e.message : String(e)));
