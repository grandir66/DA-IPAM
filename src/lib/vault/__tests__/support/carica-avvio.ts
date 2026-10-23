/**
 * Processo figlio della prova «l'avvio non carica i moduli pesanti del vault» (avvio-leggero.test.ts).
 *
 * Aggancia la risoluzione dei moduli (`module.registerHooks`) e annota (o rifiuta) ogni caricamento di `age-encryption`, `kdbxweb` e `hash-wasm`: sono
 * ESM puri con dipendenze (`@noble/*`) che vogliono Node >= 20.19, e l'app dichiara `node >=20.0.0`. Poi importa
 * quello che l'avvio raggiunge (jobs, backup, catalogo delle opzioni, avvio del vault) e lo esercita con gli
 * interruttori come da ambiente. Stampa una riga JSON con i moduli caricati. Fase `controllo`: l'aggancio non rifiuta
 * più e si crea un archivio, per provare che l'aggancio vede i caricamenti (altrimenti la prova non vale).
 */
import * as modulo from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PESANTI = /^(age-encryption|kdbxweb|hash-wasm)(\/|$)/;
const caricati = new Set<string>();
let rifiuta = process.env.PROVA_FASE !== "controllo";
// `registerHooks` (Node >= 22.15) vede sia `require` sia `import()`: sotto tsx un `import("age-encryption")` è un import
// nativo che `Module._load` non vedrebbe.
type Risolvi = (specifier: string, context: unknown) => unknown;
const { registerHooks } = modulo as unknown as { registerHooks?: (h: { resolve: (specifier: string, context: unknown, nextResolve: Risolvi) => unknown }) => void };
if (!registerHooks) throw new Error("module.registerHooks non c'è (serve Node >= 22.15): la prova non può vedere i caricamenti");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (PESANTI.test(specifier)) {
      caricati.add(specifier.split("/")[0]);
      if (rifiuta) throw new Error(`modulo pesante caricato all'avvio: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});

async function main(): Promise<void> {
  const appliance = await import("@/lib/vault/appliance");
  await import("@/lib/vault/avvio");
  await import("@/lib/backup/engine");
  await import("@/lib/opzioni/catalogo");
  await import("@/lib/cron/jobs");
  appliance.avviaVaultLocale({ credenziali: undefined });
  appliance.statoVault();
  appliance.motivoPausaVault();
  appliance.testoBannerVault();

  if (process.env.PROVA_FASE === "controllo") {
    rifiuta = false;
    const { creaArchivio } = await import("@/lib/vault/archivio");
    await creaArchivio(mkdtempSync(join(tmpdir(), "da-vault-controllo-")), { passphrase: "passphrase-di-controllo-1", chiaveDomarc: null, senzaDomarc: true, richiestaCliente: "RIC-CONTROLLO", scryptLogN: 10 });
  }
  process.stdout.write(`${JSON.stringify({ caricati: [...caricati].sort() })}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
