// scripts/misura-dns-ad.ts
// Misura in SOLA LETTURA del DNS di Active Directory di un cliente, confrontato con DA-IPAM.
// Legge via LDAP le zone integrate (forward e reverse) e conta le anomalie sui soli record degli
// host: A, AAAA, CNAME, PTR. I record di dominio (SRV, NS, SOA, `_msdcs`, apice della zona) non
// si guardano (Riccardo, 17/11/2026). Stampa solo numeri: nessun nome, nessun IP.
//
// Uso:
//   npx tsx scripts/misura-dns-ad.ts <tenantCode>
import { withTenant, getTenantDb, closeTenantDb, getAdIntegrations } from "@/lib/db-tenant";
import { connectLdap } from "@/lib/ad/ad-client";
import { avviaVault } from "@/lib/vault/avvio";

const TIPI: Record<number, string> = { 1: "A", 5: "CNAME", 12: "PTR", 28: "AAAA" };
const GIORNI_VECCHIO = 90;
const GIORNI_SPENTO = 30;

interface Voce { zona: string; nome: string; tipo: string; dato: string; statica: boolean; giorni: number | null }

/** Nome DNS nel formato dei record di AD: lunghezza, numero di etichette, poi le etichette. */
function nomeDns(b: Buffer): string {
  const etichette: string[] = [];
  let p = 2;
  const n = b[1] ?? 0;
  for (let i = 0; i < n && p < b.length; i++) {
    const l = b[p] ?? 0;
    etichette.push(b.subarray(p + 1, p + 1 + l).toString("utf8"));
    p += 1 + l;
  }
  return etichette.join(".").toLowerCase();
}

function leggiRecord(b: Buffer, adessoOre: number): { tipo: string; dato: string; statica: boolean; giorni: number | null } | null {
  if (b.length < 24) return null;
  const tipo = TIPI[b.readUInt16LE(2)];
  if (!tipo) return null;
  const ore = b.readUInt32LE(20);
  const dati = b.subarray(24, 24 + b.readUInt16LE(0));
  let dato = "";
  if (tipo === "A") dato = dati.length >= 4 ? `${dati[0]}.${dati[1]}.${dati[2]}.${dati[3]}` : "";
  else if (tipo === "AAAA") dato = dati.toString("hex");
  else dato = nomeDns(dati);
  if (!dato) return null;
  return { tipo, dato, statica: ore === 0, giorni: ore === 0 ? null : Math.floor((adessoOre - ore) / 24) };
}

function comeBuffer(v: unknown): Buffer[] {
  if (Buffer.isBuffer(v)) return [v];
  if (Array.isArray(v)) return v.filter((x): x is Buffer => Buffer.isBuffer(x));
  return [];
}

/** IP di un PTR: etichette del nodo più quelle della zona, rovesciate. */
function ipDaPtr(nome: string, zona: string): string | null {
  const z = zona.replace(/\.in-addr\.arpa$/i, "");
  const parti = [...nome.split("."), ...z.split(".")].reverse();
  return parti.length === 4 && parti.every((x) => /^\d+$/.test(x)) ? parti.join(".") : null;
}

async function misura(tenant: string): Promise<void> {
  const integrazioni = getAdIntegrations().filter((i) => i.enabled);
  if (integrazioni.length === 0) { console.log("Nessuna integrazione AD accesa."); return; }
  const adessoOre = Math.floor((Date.now() - Date.UTC(1601, 0, 1)) / 3_600_000);
  const voci: Voce[] = [];
  const zone = new Set<string>();
  let nodiSaltati = 0;

  for (const integ of integrazioni) {
    // La cache dei segreti di DA-Link si riempie in sottofondo: qualche tentativo, poi si dice l'errore.
    let client: Awaited<ReturnType<typeof connectLdap>> | null = null;
    for (let tentativo = 1; !client; tentativo++) {
      try { client = await connectLdap(integ); }
      catch (errore) {
        if (tentativo >= 6 || !/ancora stati caricati/i.test((errore as Error).message)) throw errore;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    try {
      const basi = [`DC=DomainDnsZones,${integ.base_dn}`, `DC=ForestDnsZones,${integ.base_dn}`, `CN=MicrosoftDNS,CN=System,${integ.base_dn}`];
      for (const base of basi) {
        try {
          const { searchEntries } = await client.search(base, {
            scope: "sub",
            filter: "(&(objectClass=dnsNode)(!(dNSTombstoned=TRUE)))",
            attributes: ["distinguishedName", "dnsRecord"],
            explicitBufferAttributes: ["dnsRecord"],
            paged: { pageSize: 500 },
            timeLimit: 60,
          });
          for (const e of searchEntries) {
            const m = /^DC=([^,]+),DC=([^,]+),/i.exec(String(e.dn));
            if (!m) continue;
            const nome = m[1]!.toLowerCase();
            const zona = m[2]!.toLowerCase();
            // Record di dominio: fuori dalla misura.
            if (zona === "rootdnsservers" || zona.startsWith("..") || zona.startsWith("_msdcs")) continue;
            zone.add(zona);
            if (nome === "@" || nome.startsWith("_") || nome.includes("._") || nome === "domaindnszones" || nome === "forestdnszones") { nodiSaltati++; continue; }
            for (const b of comeBuffer(e.dnsRecord)) {
              const r = leggiRecord(b, adessoOre);
              if (r) voci.push({ zona, nome, ...r });
            }
          }
        } catch (errore) {
          if ((errore as { code?: unknown }).code !== 32) console.log(`   partizione non letta (${base.split(",")[0]}): ${(errore as Error).message}`);
        }
      }
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  const inversa = (z: string) => z.endsWith(".in-addr.arpa");
  const zoneInverse = [...zone].filter(inversa);
  const zoneDirette = [...zone].filter((z) => !inversa(z) && !z.endsWith(".ip6.arpa"));
  console.log(`\n== Zone: ${zoneDirette.length} forward, ${zoneInverse.length} reverse; nodi di dominio saltati: ${nodiSaltati}`);

  const perTipo = new Map<string, { n: number; statiche: number; vecchie: number }>();
  for (const v of voci) {
    const t = perTipo.get(v.tipo) ?? { n: 0, statiche: 0, vecchie: 0 };
    t.n++; if (v.statica) t.statiche++; else if ((v.giorni ?? 0) > GIORNI_VECCHIO) t.vecchie++;
    perTipo.set(v.tipo, t);
  }
  console.log("== Record degli host per tipo (totale / statici / dinamici non rinnovati da oltre 90 giorni)");
  for (const [tipo, t] of perTipo) console.log(`   ${tipo}: ${t.n} / ${t.statiche} / ${t.vecchie}`);

  const fqdn = (v: Voce) => `${v.nome}.${v.zona}`;
  const a = voci.filter((v) => v.tipo === "A");
  const ipNomi = new Map<string, Set<string>>();
  const nomeIp = new Map<string, Set<string>>();
  for (const v of a) {
    (ipNomi.get(v.dato) ?? ipNomi.set(v.dato, new Set()).get(v.dato)!).add(fqdn(v));
    (nomeIp.get(fqdn(v)) ?? nomeIp.set(fqdn(v), new Set()).get(fqdn(v))!).add(v.dato);
  }
  const ptr = new Map<string, Set<string>>();
  let ptrIllegibili = 0;
  for (const v of voci.filter((x) => x.tipo === "PTR")) {
    const ip = ipDaPtr(v.nome, v.zona);
    if (!ip) { ptrIllegibili++; continue; }
    (ptr.get(ip) ?? ptr.set(ip, new Set()).get(ip)!).add(v.dato.replace(/\.$/, ""));
  }
  const zonaInversaDi = (ip: string) => {
    const o = ip.split(".");
    return [`${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`, `${o[1]}.${o[0]}.in-addr.arpa`, `${o[0]}.in-addr.arpa`].some((z) => zone.has(z));
  };

  const ipDoppi = [...ipNomi.values()].filter((s) => s.size > 1).length;
  const nomiDoppi = [...nomeIp.values()].filter((s) => s.size > 1).length;
  let aSenzaPtr = 0, aSenzaZonaInversa = 0, aPtrDiverso = 0;
  for (const [ip, nomi] of ipNomi) {
    const p = ptr.get(ip);
    if (!p) { if (zonaInversaDi(ip)) aSenzaPtr++; else aSenzaZonaInversa++; continue; }
    if (![...nomi].some((n) => p.has(n))) aPtrDiverso++;
  }
  let ptrSenzaA = 0, ptrDoppi = 0;
  for (const [ip, nomi] of ptr) {
    if (nomi.size > 1) ptrDoppi++;
    if (![...nomi].some((n) => nomeIp.get(n)?.has(ip))) ptrSenzaA++;
  }
  const tuttiINomi = new Set(voci.filter((v) => v.tipo !== "PTR").map(fqdn));
  const cname = voci.filter((v) => v.tipo === "CNAME");
  const cnameRotti = cname.filter((v) => {
    const bersaglio = v.dato.replace(/\.$/, "");
    return zoneDirette.some((z) => bersaglio.endsWith(`.${z}`)) && !tuttiINomi.has(bersaglio);
  }).length;

  console.log("== Coerenza interna del DNS");
  console.log(`   IP con più nomi (A): ${ipDoppi} su ${ipNomi.size} IP`);
  console.log(`   nomi con più IP (A): ${nomiDoppi} su ${nomeIp.size} nomi`);
  console.log(`   A senza PTR (la zona reverse c'è): ${aSenzaPtr}`);
  console.log(`   A senza PTR perché manca la zona reverse: ${aSenzaZonaInversa}`);
  console.log(`   A con PTR che porta un altro nome: ${aPtrDiverso}`);
  console.log(`   PTR senza un A corrispondente: ${ptrSenzaA} su ${ptr.size} (IP con più PTR: ${ptrDoppi}; PTR non leggibili: ${ptrIllegibili})`);
  console.log(`   CNAME verso un nome che non esiste nelle zone lette: ${cnameRotti} su ${cname.length}`);

  const host = getTenantDb(tenant).prepare("SELECT * FROM hosts").all() as Record<string, unknown>[];
  const perIp = new Map<string, Record<string, unknown>>();
  for (const h of host) perIp.set(String(h.ip), h);
  const corto = (s: unknown) => String(s ?? "").trim().toLowerCase().split(".")[0] ?? "";
  const giorniDa = (s: unknown) => {
    const t = Date.parse(`${String(s ?? "").replace(" ", "T")}Z`);
    return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
  };
  let fuoriIpam = 0, spenti = 0, nomeDiverso = 0, concordi = 0;
  for (const [ip, nomi] of ipNomi) {
    const h = perIp.get(ip);
    if (!h) { fuoriIpam++; continue; }
    const g = giorniDa(h.last_seen);
    if (h.status === "offline" && (g == null || g > GIORNI_SPENTO)) spenti++;
    const n = corto(h.hostname);
    if (n) { if ([...nomi].some((x) => corto(x) === n)) concordi++; else nomeDiverso++; }
  }
  const accesi = host.filter((h) => h.status === "online");
  const accesiSenzaA = accesi.filter((h) => !ipNomi.has(String(h.ip))).length;
  const accesiSenzaPtr = accesi.filter((h) => !ptr.has(String(h.ip))).length;

  console.log(`== Confronto con DA-IPAM (${host.length} host, ${accesi.length} accesi)`);
  console.log(`   A verso un IP che DA-IPAM non conosce: ${fuoriIpam}`);
  console.log(`   A verso un host spento da oltre ${GIORNI_SPENTO} giorni: ${spenti}`);
  console.log(`   A il cui nome non è quello che DA-IPAM ha per quell'IP: ${nomeDiverso} (concordi: ${concordi})`);
  console.log(`   host accesi senza nessun A: ${accesiSenzaA}; senza PTR: ${accesiSenzaPtr}`);
}

const [tenant] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/misura-dns-ad.ts <tenantCode>");
  process.exit(1);
}
avviaVault();
withTenant(tenant, () => misura(tenant))
  .catch((errore: unknown) => { console.error(`ERRORE: ${(errore as Error).message}`); process.exitCode = 1; })
  .finally(() => { closeTenantDb(tenant); setTimeout(() => process.exit(), 200); });
