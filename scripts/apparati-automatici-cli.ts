// scripts/apparati-automatici-cli.ts
// Apparati creati da soli (lib/devices/apparato-automatico.ts): prova a vuoto o applicazione per un tenant.
// Uso:  npx tsx scripts/apparati-automatici-cli.ts <tenantCode> [--applica]
// Senza --applica non scrive: elenca cosa creerebbe. Non guarda l'interruttore delle Opzioni.
import { withTenant } from "@/lib/db-tenant";
import { creaApparatiAutomatici } from "@/lib/devices/apparato-automatico";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) { console.error("Uso: npx tsx scripts/apparati-automatici-cli.ts <tenantCode> [--applica]"); process.exit(2); }
const applica = resto.includes("--applica");

withTenant(tenant, () => {
  const righe = creaApparatiAutomatici({ applica });
  for (const r of righe) {
    const coda = r.esito === "saltato" ? `saltato: ${r.motivo}` : `${r.esito}: «${r.nome}» ${r.protocollo}, ${r.legami} credenziali`;
    console.log(`${r.ip.padEnd(16)} ${(r.classe ?? "-").padEnd(14)} ${coda}`);
  }
  const conta = (e: string) => righe.filter((r) => r.esito === e).length;
  console.log(`\n${applica ? "Creati" : "Da creare"}: ${conta(applica ? "creato" : "da_creare")} · saltati: ${conta("saltato")} · host esaminati: ${righe.length}`);
});
