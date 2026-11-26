// scripts/misura-dns-ad.ts
// Misura in SOLA LETTURA del DNS di Active Directory di un cliente, confrontato con DA-IPAM.
// Legge dal DC con lo stesso codice della sincronizzazione (`leggiDnsAd`) e conta le anomalie con
// lo stesso calcolo della scheda «DNS» (`anomalieDns`), senza scrivere niente in archivio.
// Solo i record degli host: A, AAAA, CNAME, PTR (Riccardo, 17/11/2026). Stampa solo numeri:
// nessun nome, nessun IP. Serve anche da riscontro: i numeri devono coincidere con la scheda.
//
// Uso (sul server, con l'ambiente del servizio caricato):
//   npx tsx scripts/misura-dns-ad.ts <tenantCode>
import { withTenant, closeTenantDb, getAdIntegrations, getCidrReti, getHostPerDnsAd, getVolutiDnsAd } from "@/lib/db-tenant";
import { connectLdap } from "@/lib/ad/ad-client";
import { avviaVault } from "@/lib/vault/avvio";
import { leggiDnsAd } from "@/lib/ad/dns/lettura";
import { anomalieDns, conteggiAnomalieDns, ETICHETTE_ANOMALIA_DNS, TIPI_ANOMALIA_DNS } from "@/lib/ad/dns/anomalie";

async function collega(integ: Parameters<typeof connectLdap>[0]) {
  // La cache dei segreti di DA-Link si riempie in sottofondo: qualche tentativo, poi si dice l'errore.
  for (let tentativo = 1; ; tentativo++) {
    try { return await connectLdap(integ); }
    catch (errore) {
      if (tentativo >= 6 || !/ancora stati caricati/i.test((errore as Error).message)) throw errore;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function misura(): Promise<void> {
  const integrazioni = getAdIntegrations().filter((i) => i.enabled);
  if (integrazioni.length === 0) { console.log("Nessuna integrazione AD accesa."); return; }
  for (const integ of integrazioni) {
    const client = await collega(integ);
    let lettura;
    try { lettura = await leggiDnsAd(client, integ.base_dn); }
    finally { await client.unbind().catch(() => undefined); }

    console.log(`\n== Integrazione #${integ.id}: partizioni lette ${lettura.partizioniLette}, errori ${lettura.errori.length}`);
    for (const e of lettura.errori) console.log(`   errore: ${e}`);
    console.log(`== Zone: ${lettura.zone.filter((z) => !z.inversa).length} forward, ${lettura.zone.filter((z) => z.inversa).length} reverse`);
    console.log("== Record degli host per tipo (totale / statici)");
    for (const tipo of ["A", "AAAA", "CNAME", "PTR"] as const) {
      const v = lettura.voci.filter((x) => x.tipo === tipo);
      if (v.length > 0) console.log(`   ${tipo}: ${v.length} / ${v.filter((x) => x.statica).length}`);
    }
    const host = getHostPerDnsAd();
    const anomalie = anomalieDns({
      zone: lettura.zone, voci: lettura.voci, host, reti: getCidrReti(),
      voluti: new Set(getVolutiDnsAd(integ.id).map((v) => v.chiave)), adesso: new Date(),
    });
    const conteggi = conteggiAnomalieDns(anomalie);
    console.log(`== Anomalie: ${anomalie.length} (host in DA-IPAM: ${host.length}, accesi ${host.filter((h) => h.status === "online").length})`);
    for (const t of TIPI_ANOMALIA_DNS) console.log(`   ${ETICHETTE_ANOMALIA_DNS[t]}: ${conteggi[t]}`);
  }
}

const [tenant] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/misura-dns-ad.ts <tenantCode>");
  process.exit(1);
}
avviaVault();
withTenant(tenant, () => misura())
  .catch((errore: unknown) => { console.error(`ERRORE: ${(errore as Error).message}`); process.exitCode = 1; })
  .finally(() => { closeTenantDb(tenant); setTimeout(() => process.exit(), 200); });
