// scripts/cambio-inquilino-cli.ts
// Righe che portano i dati dell'apparato che aveva prima quell'indirizzo (src/lib/hosts/cambio-inquilino.ts).
//
// Uso:
//   npx tsx scripts/cambio-inquilino-cli.ts <tenantCode>             prova a vuoto: elenca le righe, non scrive
//   npx tsx scripts/cambio-inquilino-cli.ts <tenantCode> --applica   svuota quelle righe e ricalcola
//
// Non guarda l'interruttore del cliente: è una bonifica lanciata a mano.
import { withTenant, getTenantDb, closeTenantDb } from "@/lib/db-tenant";
import { righeEreditate, svuotaInquilino } from "@/lib/hosts/cambio-inquilino";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/cambio-inquilino-cli.ts <tenantCode> [--applica]");
  process.exit(1);
}
const applica = resto.includes("--applica");

withTenant(tenant, () => {
  const db = getTenantDb(tenant);
  const righe = righeEreditate(db);
  for (const r of righe) {
    console.log([r.id, r.ip, r.nome ?? "-", r.mac, r.produttore ?? "-", r.snmp ? "snmp" : "-", r.classe ?? "-", r.categoria ?? "-", r.a_mano ? "a mano" : "-"].join(" | "));
    if (applica) svuotaInquilino(db, r.id);
  }
  console.log(`${righe.length} righe ${applica ? "svuotate" : "da svuotare (prova a vuoto)"}`);
});
closeTenantDb(tenant);
