// scripts/funzioni-cli.ts
// Le funzioni degli apparati riconosciute dalle letture già fatte (src/lib/classification/funzioni*.ts).
//
// Uso:
//   npx tsx scripts/funzioni-cli.ts <tenantCode>             prova a vuoto: elenca che cosa scriverebbe
//   npx tsx scripts/funzioni-cli.ts <tenantCode> --applica   scrive
import { withTenant, getTenantDb, closeTenantDb } from "@/lib/db-tenant";
import { ricalcolaFunzioni } from "@/lib/classification/funzioni-db";
import { etichettaFunzione } from "@/lib/classification/funzioni";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/funzioni-cli.ts <tenantCode> [--applica]");
  process.exit(1);
}
const applica = resto.includes("--applica");

withTenant(tenant, () => {
  const r = ricalcolaFunzioni(getTenantDb(tenant), { applica });
  const perFunzione = new Map<string, string[]>();
  for (const t of r.trovate) {
    const elenco = perFunzione.get(t.funzione) ?? [];
    elenco.push(`${t.nome} (${t.origine})`);
    perFunzione.set(t.funzione, elenco);
  }
  for (const [f, elenco] of [...perFunzione.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${etichettaFunzione(f)}: ${elenco.length}`);
    for (const riga of elenco.slice(0, 40)) console.log(`   ${riga}`);
  }
  const host = new Set(r.trovate.map((t) => t.host_id)).size;
  console.log(`${r.trovate.length} funzioni su ${host} apparati${applica ? `: ${r.scritte} scritte, ${r.tolte} tolte` : " (prova a vuoto, niente scritto)"}`);
});
closeTenantDb(tenant);
