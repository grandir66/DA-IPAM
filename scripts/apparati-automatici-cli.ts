// scripts/apparati-automatici-cli.ts
// Apparati creati da soli (lib/devices/apparato-automatico.ts): prova a vuoto o applicazione per un tenant.
// Uso:  npx tsx scripts/apparati-automatici-cli.ts <tenantCode> [--applica] [--in-lettura-dal AAAA-MM-GG] [--leggi]
//   senza opzioni        prova a vuoto: elenca cosa creerebbe, non scrive
//   --applica            crea gli apparati e li mette nel job «Apparati creati da soli» (lettura quotidiana)
//   --in-lettura-dal D   mette in quel job gli apparati creati dal giorno D che nessun job legge (recupero)
//   --leggi              lancia subito, da questo processo, il giro dei job toccati (prima lettura)
// Non guarda l'interruttore delle Opzioni. Il server vede un job nuovo solo dopo `systemctl restart da-ipam`.
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaApparatiAutomatici, mettiInLettura } from "@/lib/devices/apparato-automatico";
import { aggiungiAlleLettureAutomatiche } from "@/lib/devices/letture-automatiche";
import { runJob } from "@/lib/cron/jobs";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) { console.error("Uso: npx tsx scripts/apparati-automatici-cli.ts <tenantCode> [--applica] [--in-lettura-dal AAAA-MM-GG] [--leggi]"); process.exit(2); }
const applica = resto.includes("--applica");
const dal = resto.includes("--in-lettura-dal") ? resto[resto.indexOf("--in-lettura-dal") + 1] : null;
if (dal !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dal ?? "")) { console.error("--in-lettura-dal vuole una data AAAA-MM-GG"); process.exit(2); }

void withTenant(tenant, async () => {
  const job = new Set<number>();
  if (dal) {
    const db = getTenantDb(tenant);
    const ids = (db.prepare("SELECT id FROM network_devices WHERE created_at >= ? ORDER BY id").all(dal) as Array<{ id: number }>).map((r) => r.id);
    const toccati = aggiungiAlleLettureAutomatiche(db, ids);
    toccati.forEach((j) => job.add(j));
    console.log(`Apparati creati dal ${dal}: ${ids.length} · job «Lettura apparati» toccati: ${toccati.join(", ") || "nessuno"}`);
  } else {
    const righe = creaApparatiAutomatici({ applica });
    for (const r of righe) {
      const coda = r.esito === "saltato" ? `saltato: ${r.motivo}` : `${r.esito}: «${r.nome}» ${r.protocollo}, ${r.legami} credenziali`;
      console.log(`${r.ip.padEnd(16)} ${(r.classe ?? "-").padEnd(14)} ${coda}`);
    }
    const conta = (e: string) => righe.filter((r) => r.esito === e).length;
    console.log(`\n${applica ? "Creati" : "Da creare"}: ${conta(applica ? "creato" : "da_creare")} · saltati: ${conta("saltato")} · host esaminati: ${righe.length}`);
    if (applica) mettiInLettura(righe).forEach((j) => job.add(j));
  }
  if (resto.includes("--leggi")) {
    for (const id of job) {
      const e = await runJob(id);
      console.log(`Giro del job #${id}: ${e.esito}${e.motivo ? ` (${e.motivo})` : ""}`);
    }
  }
  process.exit(0);
});
