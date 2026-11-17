/**
 * Quello che la scheda «DNS» di Active Directory mostra: stato dell'ultima lettura, zone,
 * anomalie calcolate adesso dai record in archivio e dagli host. Va chiamata dentro il contesto
 * del cliente (`withTenantFromSession` o `withTenant`).
 */
import {
  getCidrReti, getHostPerDnsAd, getRecordDnsAd, getStatoDnsAd, getVolutiDnsAd, getZoneDnsAd,
  type RigaRecordDnsAd, type StatoDnsAd,
} from "@/lib/db-tenant";
import { anomalieDns, conteggiAnomalieDns, type AnomaliaDns, type TipoAnomaliaDns } from "./anomalie";
import type { VoceDns, ZonaDns } from "./record";

export interface VistaDnsAd {
  stato: StatoDnsAd;
  zone: { nome: string; inversa: boolean; record: number }[];
  record: number;
  conteggi: Record<TipoAnomaliaDns, number>;
  anomalie: AnomaliaDns[];
  voluti: { chiave: string; nota: string | null; da: string | null; il: string }[];
}

function voce(r: RigaRecordDnsAd): VoceDns {
  return { zona: r.zona, nome: r.nome, fqdn: r.fqdn, tipo: r.tipo, dato: r.dato, ip: r.ip, statica: r.statica === 1, rinnovataIl: r.rinnovata_il, ttl: r.ttl };
}

export function vistaDnsAd(integrationId: number, adesso: Date = new Date()): VistaDnsAd {
  const righe = getRecordDnsAd(integrationId);
  const zone: ZonaDns[] = getZoneDnsAd(integrationId).map((z) => ({ nome: z.nome, inversa: z.inversa === 1, partizione: z.partizione as ZonaDns["partizione"] }));
  const voluti = getVolutiDnsAd(integrationId);
  const anomalie = anomalieDns({
    zone, voci: righe.map(voce), host: getHostPerDnsAd(), reti: getCidrReti(),
    voluti: new Set(voluti.map((v) => v.chiave)), adesso,
  });
  const perZona = new Map<string, number>();
  for (const r of righe) perZona.set(r.zona, (perZona.get(r.zona) ?? 0) + 1);
  return {
    stato: getStatoDnsAd(integrationId),
    zone: zone.map((z) => ({ nome: z.nome, inversa: z.inversa, record: perZona.get(z.nome) ?? 0 })),
    record: righe.length,
    conteggi: conteggiAnomalieDns(anomalie),
    anomalie,
    voluti,
  };
}
