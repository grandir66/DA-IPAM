// scripts/attribution-recompute-cli.ts
// Ricalcolo Attribution v2 offline/backfill per un tenant: emette le evidenze dai
// segnali già in DB (nessun probe nuovo) e rifonde vendor/categoria/OS su hosts.attr_*.
// Utile dopo un deploy che introduce/corregge emettitori (es. alias vendor, MAC virtuali)
// per applicare la correzione agli host già scansionati senza aspettare il prossimo scan.
//
// Uso:
//   npx tsx scripts/attribution-recompute-cli.ts <tenantCode> [cidr] [--no-vendor-refresh]
//
// Senza [cidr]: ricalcola tutte le reti del tenant. Con [cidr]: solo quella rete.
// Prima del ricalcolo vero e proprio, ririsolve dal MAC i vendor placeholder
// (es. "IEEE Registration Authority") usando la KB vendorizzata — così le nuove
// evidenze vendor partono dal dato aggiornato invece che dal placeholder scritto
// a scan-time. `--no-vendor-refresh` salta questo passo.
//
// Nota ENCRYPTION_KEY: NON richiesta. Il motore Attribution v2 (src/lib/attribution/)
// legge solo segnali già persistiti in chiaro (hosts, ad_computers, wazuh_*,
// device_neighbors) e non tocca credenziali cifrate (host_credentials, integrazioni).
// Se compare comunque un errore relativo a ENCRYPTION_KEY, non blocchiamo con uno
// stack trace: lo segnaliamo con un messaggio chiaro ed usciamo con exit code 1.
import fs from "fs";
import path from "path";
import { resolveDataDir } from "@/lib/data-dir";
import {
  withTenant,
  getTenantDb,
  closeTenantDb,
  getNetworks,
  getHostsByNetwork,
  getAttributionSignalsForHost,
  refreshHostVendorsFromMac,
} from "@/lib/db-tenant";
import { recomputeHostAttribution } from "@/lib/attribution/recompute";
import { withLockRetry, isLockError } from "@/lib/attribution/retry";

interface Summary {
  networks: number;
  hosts: number;
  processed: number;
  skippedNoSignals: number;
  skippedLocked: number;
  withCategory: number;
  withVendor: number;
  withOs: number;
  vendorRefreshed: number | null;
}

// CLI standalone: nessun altro reader/writer sta condividendo l'handle di
// questo processo (a differenza del server, dove più richieste si spartiscono
// la stessa connessione cacheata). Il busy_timeout di default (5000ms, vedi
// db-tenant.ts) basta per la contesa normale server↔server, ma la CLI gira
// spesso in backfill lunghi in parallelo al servizio che scrive sullo stesso
// tenant DB (misurato in produzione: SQLITE_BUSY_SNAPSHOT durante un giro sulla
// rete 192.168.15.0/24). Alziamo il timeout SOLO per questa connessione.
const CLI_BUSY_TIMEOUT_MS = 30_000;

async function run(tenantCode: string, cidr: string | undefined, skipVendorRefresh: boolean): Promise<Summary> {
  const summary: Summary = {
    networks: 0, hosts: 0, processed: 0, skippedNoSignals: 0, skippedLocked: 0,
    withCategory: 0, withVendor: 0, withOs: 0, vendorRefreshed: null,
  };

  return withTenant(tenantCode, async () => {
    const dbh = getTenantDb(tenantCode);
    dbh.pragma(`busy_timeout = ${CLI_BUSY_TIMEOUT_MS}`);
    const allNetworks = getNetworks();
    const networks = cidr ? allNetworks.filter((n) => n.cidr === cidr) : allNetworks;

    if (cidr && networks.length === 0) {
      throw new Error(`nessuna rete con cidr "${cidr}" nel tenant "${tenantCode}"`);
    }
    summary.networks = networks.length;

    // Ririsolve i vendor placeholder (es. "IEEE Registration Authority") dal MAC
    // usando la KB PRIMA del ricalcolo: senza questo passo il ricalcolo legge
    // hosts.vendor così com'è stato scritto a scan-time e il guadagno della KB
    // resta invisibile finché l'host non viene riscansionato (caso reale VM
    // 533/tenant 70791, 16 host bloccati dopo il deploy KB v0.3.236).
    if (!skipVendorRefresh) {
      const vendorResult = cidr
        ? refreshHostVendorsFromMac(networks[0].id)
        : refreshHostVendorsFromMac();
      summary.vendorRefreshed = vendorResult.updated;
      console.log(`[attribution-recompute] vendor ririsolti dal MAC: ${vendorResult.updated}/${vendorResult.examined} (non risolvibili: ${vendorResult.unresolved})`);
    }

    for (const network of networks) {
      const hosts = getHostsByNetwork(network.id);
      summary.hosts += hosts.length;
      console.log(`[attribution-recompute] rete ${network.cidr} (${network.name}): ${hosts.length} host`);

      for (const host of hosts) {
        const signals = getAttributionSignalsForHost(host.id);
        if (!signals) {
          summary.skippedNoSignals += 1;
          continue;
        }
        try {
          const result = await withLockRetry(() => recomputeHostAttribution(dbh, signals, "backfill"));
          summary.processed += 1;
          if (result.category.claim) summary.withCategory += 1;
          if (result.vendor.claim) summary.withVendor += 1;
          if (result.os.claim) summary.withOs += 1;
        } catch (err) {
          if (isLockError(err)) {
            summary.skippedLocked += 1;
            console.error(`[attribution-recompute] host ${host.ip} saltato dopo retry (DB lock persistente): ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
          throw err;
        }
      }
    }

    return summary;
  });
}

function printSummary(summary: Summary): void {
  console.log("");
  console.log("=== Riepilogo ricalcolo attribuzione ===");
  if (summary.vendorRefreshed !== null) {
    console.log(`Vendor ririsolti:       ${summary.vendorRefreshed}`);
  }
  console.log(`Reti valutate:          ${summary.networks}`);
  console.log(`Host totali:            ${summary.hosts}`);
  console.log(`Host processati:        ${summary.processed}`);
  if (summary.skippedNoSignals > 0) {
    console.log(`Host saltati (no dati): ${summary.skippedNoSignals}`);
  }
  if (summary.skippedLocked > 0) {
    console.log(`Host saltati (lock):    ${summary.skippedLocked}`);
  }
  console.log(`Con categoria:          ${summary.withCategory}`);
  console.log(`Con vendor:             ${summary.withVendor}`);
  console.log(`Con OS:                 ${summary.withOs}`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const skipVendorRefresh = rawArgs.includes("--no-vendor-refresh");
  const positional = rawArgs.filter((a) => a !== "--no-vendor-refresh");
  const tenantCode = positional[0];
  const cidr = positional[1];

  if (!tenantCode) {
    console.error("Uso: npx tsx scripts/attribution-recompute-cli.ts <tenantCode> [cidr] [--no-vendor-refresh]");
    process.exit(1);
  }

  const dbPath = path.join(resolveDataDir(), "tenants", `${tenantCode}.db`);
  if (!fs.existsSync(dbPath)) {
    console.error(`[attribution-recompute] tenant "${tenantCode}" non trovato (${dbPath} assente).`);
    process.exit(1);
  }

  try {
    const summary = await run(tenantCode, cidr, skipVendorRefresh);
    printSummary(summary);
    closeTenantDb(tenantCode);
    // Un batch dove OGNI host è stato saltato per lock persistente o dati
    // mancanti non ha applicato nessuna correzione: va segnalato come
    // fallimento (exit 1) anche se nessuna eccezione hard si è propagata,
    // cosi' un cron/orchestratore a monte lo rileva e puo' ritentare il giro.
    process.exit(summary.processed > 0 ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENCRYPTION_KEY")) {
      console.error(`[attribution-recompute] errore ENCRYPTION_KEY (non richiesta da questo script): ${msg}`);
    } else {
      console.error(`[attribution-recompute] errore: ${msg}`);
    }
    process.exit(1);
  }
}

main();
