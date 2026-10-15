// scripts/credenziali/misure-2a.ts
/**
 * Misure mancanti della 2a (tappa 2 credenziali, T1 «Sul server» del piano
 * 2026-10-15-tappa2-archivio-credenziali), sulla COPIA dei dati: solo
 * conteggi, a terminale, mai un segreto. Le misure sono descritte in
 * `appoggio-misure.ts` (#31/D3, D5, D8, D1b, 2e).
 *
 * Stesso ordine obbligato di fotografia-scelte.ts (vincolo «Script sulle
 * copie»): guardia pura, ambiente spostato su --dati, solo dopo il modulo
 * d'appoggio che importa db-tenant, e guardia ripetuta sui percorsi dei moduli
 * prima di aprire un DB. Ogni errore: uscita 2, niente aperto.
 *
 * Uso:  npx tsx scripts/credenziali/misure-2a.ts --dati <copia dei dati> [--dati-servizio <cartella>]
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo).
 *   Senza DA_INVENT_DATA_DIR nell'ambiente (l'hub non ce l'ha) serve
 *   --dati-servizio con la cartella dati del servizio.
 *   Uscita: 0 fatto, 2 non partito.
 */
import path from "node:path";
import { cartelleServizio, controllaCopia } from "../../src/lib/credentials/guardia-copia";

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/credenziali/misure-2a.ts --dati <copia dei dati> [--dati-servizio <cartella>]\n");
  return 2;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  // Un'opzione scritta senza valore vale "" (errore), non «assente».
  const val = (k: string) => (a.indexOf(k) >= 0 ? (a[a.indexOf(k) + 1] ?? "") : undefined);
  const datiArg = val("--dati");
  if (!datiArg) return uso();
  if (!process.env.ENCRYPTION_KEY?.trim()) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare le misure.");

  // Le cartelle dati del servizio, lette PRIMA di sovrascrivere l'ambiente.
  // Senza DA_INVENT_DATA_DIR serve --dati-servizio: non si ricava da cwd.
  const servizio = cartelleServizio(process.env, val("--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio: servizio.cartelle };
  const erroriPrima = controllaCopia(attesi);
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}`);

  process.env.DA_INVENT_DATA_DIR = attesi.dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-misure");
  const erroriDopo = controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() });
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  const righe: string[] = ["== Hub", ...appoggio.misureHub()];
  for (const code of appoggio.elencaTenant()) {
    righe.push(`== Tenant ${code}`, ...appoggio.misureTenant(code));
  }
  appoggio.chiudiTutto();
  process.stdout.write(`${righe.join("\n")}\n`);
  return 0;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
