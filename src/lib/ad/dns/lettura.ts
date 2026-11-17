/**
 * Lettura in SOLA LETTURA del DNS integrato in Active Directory, via LDAP, dalle tre partizioni
 * dove AD può tenerlo: dominio, foresta e il contenitore di sistema (domini nati prima del 2003).
 * Una partizione che non esiste (codice LDAP 32) non è un guasto; ogni altro errore finisce in
 * `errori`, e chi chiama decide di non toccare l'archivio (una lettura fallita non lo svuota).
 */
import type { Client } from "ldapts";
import { ipDaPtr, leggiRecord, nodoDiDominio, zonaDiDominio, zonaInversa, type VoceDns, type ZonaDns } from "./record";

export interface LetturaDnsAd {
  zone: ZonaDns[];
  voci: VoceDns[];
  partizioniLette: number;
  errori: string[];
}

function comeBuffer(v: unknown): Buffer[] {
  if (Buffer.isBuffer(v)) return [v];
  if (Array.isArray(v)) return v.filter((x): x is Buffer => Buffer.isBuffer(x));
  return [];
}

function nonEsiste(errore: unknown): boolean {
  return typeof errore === "object" && errore !== null && (errore as { code?: unknown }).code === 32;
}

/** `DC=nodo,DC=zona,…` → nodo e zona; `DC=zona,CN=MicrosoftDNS,…` → solo la zona. */
function primeDue(dn: string): [string, string] | null {
  const m = /^DC=((?:[^,\\]|\\.)+),DC=((?:[^,\\]|\\.)+),/i.exec(dn);
  return m ? [m[1]!.replace(/\\(.)/g, "$1").toLowerCase(), m[2]!.replace(/\\(.)/g, "$1").toLowerCase()] : null;
}

export async function leggiDnsAd(client: Client, baseDn: string): Promise<LetturaDnsAd> {
  const basi: { dn: string; partizione: ZonaDns["partizione"] }[] = [
    { dn: `DC=DomainDnsZones,${baseDn}`, partizione: "dominio" },
    { dn: `DC=ForestDnsZones,${baseDn}`, partizione: "foresta" },
    { dn: `CN=MicrosoftDNS,CN=System,${baseDn}`, partizione: "sistema" },
  ];
  const zone = new Map<string, ZonaDns>();
  const voci: VoceDns[] = [];
  const errori: string[] = [];
  let partizioniLette = 0;

  for (const base of basi) {
    try {
      const { searchEntries: zoneLette } = await client.search(base.dn, {
        scope: "sub",
        filter: "(objectClass=dnsZone)",
        attributes: ["name"],
        paged: { pageSize: 200 },
        timeLimit: 30,
      });
      for (const z of zoneLette) {
        const nome = String(Array.isArray(z.name) ? z.name[0] : z.name ?? "").toLowerCase();
        if (!nome || zonaDiDominio(nome) || zone.has(nome)) continue;
        zone.set(nome, { nome, inversa: zonaInversa(nome), partizione: base.partizione });
      }
      const { searchEntries: nodi } = await client.search(base.dn, {
        scope: "sub",
        filter: "(&(objectClass=dnsNode)(!(dNSTombstoned=TRUE)))",
        attributes: ["dnsRecord"],
        explicitBufferAttributes: ["dnsRecord"],
        paged: { pageSize: 500 },
        timeLimit: 60,
      });
      for (const nodo of nodi) {
        const parti = primeDue(String(nodo.dn));
        if (!parti) continue;
        const [nome, zona] = parti;
        if (zonaDiDominio(zona) || nodoDiDominio(nome)) continue;
        for (const b of comeBuffer(nodo.dnsRecord)) {
          const r = leggiRecord(b);
          if (!r) continue;
          voci.push({
            zona,
            nome,
            fqdn: `${nome}.${zona}`,
            ...r,
            ip: r.tipo === "A" ? r.dato : r.tipo === "PTR" ? ipDaPtr(nome, zona) : null,
          });
        }
      }
      partizioniLette++;
    } catch (errore) {
      if (nonEsiste(errore)) continue;
      errori.push(`${base.partizione}: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
  return { zone: [...zone.values()], voci, partizioniLette, errori };
}
