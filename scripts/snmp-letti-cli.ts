// scripts/snmp-letti-cli.ts
// Segna validata la credenziale SNMP sugli host che hanno già risposto a SNMP (src/lib/credentials/snmp-letto.ts).
//
// Uso:
//   npx tsx scripts/snmp-letti-cli.ts <tenantCode>             prova a vuoto: elenca gli host
//   npx tsx scripts/snmp-letti-cli.ts <tenantCode> --applica   scrive
import { withTenant, getTenantDb, closeTenantDb } from "@/lib/db-tenant";
import { validaSnmpGiaLetti } from "@/lib/credentials/snmp-letto";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/snmp-letti-cli.ts <tenantCode> [--applica]");
  process.exit(1);
}
const applica = resto.includes("--applica");
withTenant(tenant, () => {
  const r = validaSnmpGiaLetti(getTenantDb(tenant), { applica });
  for (const n of r.nomi) console.log(`   ${n}`);
  console.log(`${r.letti} host con SNMP letto: ${r.segnati} ${applica ? "segnati" : "da segnare"}, ${r.gia_validi} già validi, ${r.senza_voce} letti con una community senza voce in archivio${applica ? "" : " (prova a vuoto, niente scritto)"}`);
});
closeTenantDb(tenant);
