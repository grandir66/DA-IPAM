/**
 * misura-db-tenant.ts — misura un DB tenant in sola lettura (tappa 3, T3-01).
 *
 * Stampa solo numeri, nomi di tabella e di colonna: niente MAC, IP o nomi del
 * cliente. Si lancia prima e dopo ogni intervento sul database, sullo stesso file.
 *
 * Uso:  npx tsx scripts/misura-db-tenant.ts <file.db> [--senza-spazio] [--json]
 *   --senza-spazio  salta dbstat (lento sui DB grandi): niente byte per tabella
 *   --json          stampa la misura in JSON invece della tabella leggibile
 */
import { apriInSolaLettura, misuraDbTenant, tabellaLeggibile } from "../src/lib/db-maintenance/misura";

function main(): number {
  const argomenti = process.argv.slice(2);
  const file = argomenti.find((a) => !a.startsWith("--"));
  const sconosciuti = argomenti.filter((a) => a.startsWith("--") && a !== "--senza-spazio" && a !== "--json");
  if (!file || sconosciuti.length > 0) {
    process.stderr.write("Uso: npx tsx scripts/misura-db-tenant.ts <file.db> [--senza-spazio] [--json]\n");
    return 2;
  }
  const db = apriInSolaLettura(file);
  try {
    const misura = misuraDbTenant(db, { senzaSpazio: argomenti.includes("--senza-spazio") });
    process.stdout.write(argomenti.includes("--json") ? `${JSON.stringify(misura, null, 2)}\n` : `${tabellaLeggibile(misura)}\n`);
  } finally {
    db.close();
  }
  return 0;
}

process.exitCode = main();
