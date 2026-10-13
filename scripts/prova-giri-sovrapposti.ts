/**
 * prova-giri-sovrapposti.ts — due giri sovrapposti su una COPIA del DB di un
 * tenant (tappa 3, T3-22: verifica di INV-1 e INV-2 sul dato vero).
 *
 * Copia il file dato in una cartella di lavoro nuova, lo registra in un hub di
 * prova creato lì accanto e fa girare la sequenza di
 * `src/lib/scanner/__tests__/support/giri-sovrapposti.ts`: giro A lento, giro B
 * sulla stessa rete durante A, host visti da altri durante A, giro a zero vivi.
 * Niente esce sulla rete (esecutore finto + guardia di rete) e il file dato non
 * si apre mai: si lavora sulla copia della copia.
 *
 * Rifiuta di partire se la copia, la cartella dei dati o l'hub di prova non
 * stanno dentro la cartella di lavoro, o se la cartella di lavoro non è in una
 * cartella temporanea. Stampa solo conteggi; i registri della scansione (che
 * contengono indirizzi) restano in un file nella cartella di lavoro.
 *
 * Uso:  npx tsx scripts/prova-giri-sovrapposti.ts <copia.db> --cartella <scratchpad> [--json]
 *   Il codice del tenant è il nome del file senza `.db`.
 *   Esce 0 se non c'è accavallamento né host vivo spento, 1 se il difetto c'è,
 *   2 se non è partita.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/prova-giri-sovrapposti.ts <copia.db> --cartella <scratchpad> [--json]\n");
  return 2;
}

async function main(): Promise<number> {
  const argomenti = process.argv.slice(2);
  const iCartella = argomenti.indexOf("--cartella");
  const cartella = iCartella >= 0 ? argomenti[iCartella + 1] : undefined;
  const json = argomenti.includes("--json");
  const liberi = argomenti.filter((a, i) => !a.startsWith("--") && i !== iCartella + 1);
  const sconosciuti = argomenti.filter((a) => a.startsWith("--") && a !== "--cartella" && a !== "--json");
  if (!cartella || liberi.length !== 1 || sconosciuti.length > 0) return uso();

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");

  const timbro = new Date().toISOString().replace(/[:.]/g, "-");
  const lavoro = path.join(path.resolve(cartella), `giri-sovrapposti-${timbro}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const registro = path.join(lavoro, "scansione.log");

  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);

  // Copia della copia: il file dato si legge e basta.
  const destinazione = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(destinazione), { recursive: true });
  fs.copyFileSync(sorgente, destinazione);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${destinazione}-wal`);

  // Ambiente PRIMA di caricare i moduli del database (fissano i percorsi al caricamento).
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");

  // I registri della scansione contengono indirizzi: vanno nel file, non a schermo.
  const scrivi = (livello: string) => (...parti: unknown[]) => {
    const testo = parti.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === "string" ? p : JSON.stringify(p))).join(" ");
    try {
      fs.appendFileSync(registro, `[${livello}] ${testo}\n`);
    } catch {
      /* il registro non deve far fallire la prova */
    }
  };
  console.log = scrivi("log");
  console.info = scrivi("info");
  console.warn = scrivi("warn");
  console.error = scrivi("error");
  console.debug = scrivi("debug");

  const { createTenant } = await import("../src/lib/db-hub");
  const { eseguiGiriSovrapposti, righeRapporto } = await import("../src/lib/scanner/__tests__/support/giri-sovrapposti");

  createTenant({
    codice_cliente: tenant,
    ragione_sociale: "Copia per la prova dei giri sovrapposti",
    indirizzo: null,
    citta: null,
    provincia: null,
    cap: null,
    telefono: null,
    email: null,
    piva: null,
    cf: null,
    referente: null,
    note: null,
    active: 1,
  });

  let versione = "?";
  try {
    versione = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "?";
  } catch {
    /* versione illeggibile: resta «?» */
  }

  try {
    const rapporto = await eseguiGiriSovrapposti(tenant);
    const intestazione = [
      `Prova dei giri sovrapposti — ${new Date().toISOString()}`,
      `Codice: v${versione}; fonte: copia del DB (file del ${fs.statSync(sorgente).mtime.toISOString()}), lavorata in una sua copia`,
    ];
    process.stdout.write(
      json
        ? `${JSON.stringify({ versione, eseguitaIl: new Date().toISOString(), ...rapporto }, null, 2)}\n`
        : `${[...intestazione, ...righeRapporto(rapporto)].join("\n")}\n`,
    );
    return rapporto.verdetto.ok ? 0 : 1;
  } catch (e) {
    scrivi("error")(e);
    process.stderr.write(`Prova non conclusa (${e instanceof Error ? e.name : "errore"}): dettagli nel registro della cartella di lavoro.\n`);
    return 2;
  }
}

// I moduli del database e i timer della scansione tengono vivo il processo: si esce a mano.
main().then(
  (codice) => process.exit(codice),
  () => process.exit(2),
);
