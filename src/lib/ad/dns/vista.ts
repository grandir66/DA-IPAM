/**
 * Quello che la scheda «DNS» di Active Directory mostra: stato dell'ultima lettura, zone,
 * anomalie calcolate adesso dai record in archivio e dagli host. Va chiamata dentro il contesto
 * del cliente (`withTenantFromSession` o `withTenant`).
 */
import {
  getAdIntegrationById, getCidrReti, getHostPerDnsAd, getRecordDnsAd, getStatoDnsAd, getVolutiDnsAd, getZoneDnsAd,
  type RigaRecordDnsAd, type StatoDnsAd,
} from "@/lib/db-tenant";
import { statoScritturaDns, type StatoScritturaDns } from "./accesso";
import { correzioniPer, type Correzione } from "./correzioni";
import { ammessiDi } from "./esecuzione";
import { convalidaPasso } from "./comandi";
import { PREFISSO_VOCE_NUOVA, voceNuovaDa } from "./nuova";
import { anomalieDns, conteggiAnomalieDns, type AnomaliaDns, type TipoAnomaliaDns } from "./anomalie";
import type { VoceDns, ZonaDns } from "./record";

export interface VistaDnsAd {
  stato: StatoDnsAd;
  zone: { nome: string; inversa: boolean; record: number }[];
  record: number;
  conteggi: Record<TipoAnomaliaDns, number>;
  anomalie: (AnomaliaDns & { correzioni: Correzione[] })[];
  /** Le correzioni sul DC: accese con quale utenza, oppure perché sono spente. */
  scrittura: StatoScritturaDns;
  /** Come sono messe le correzioni su questo dominio (niente segreti: solo interruttori e id della voce). */
  impostazioni: { dns_scrittura: boolean; dns_usa_winrm_dc: boolean; dns_credential_id: number | null; haVoceWinrmDc: boolean };
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
  const integrazione = getAdIntegrationById(integrationId);
  const voci = righe.map(voce);
  const host = getHostPerDnsAd();
  const protetti = integrazione ? ammessiDi(integrazione) : null;
  const ctx = { zone, voci, host, dominio: integrazione?.domain ?? "", protetti: { nomi: protetti?.nomiDc ?? new Set<string>(), ip: protetti?.ipDc ?? new Set<string>() } };
  const perZona = new Map<string, number>();
  for (const r of righe) perZona.set(r.zona, (perZona.get(r.zona) ?? 0) + 1);
  return {
    stato: getStatoDnsAd(integrationId),
    zone: zone.map((z) => ({ nome: z.nome, inversa: z.inversa, record: perZona.get(z.nome) ?? 0 })),
    record: righe.length,
    conteggi: conteggiAnomalieDns(anomalie),
    anomalie: anomalie.map((a) => ({ ...a, correzioni: integrazione ? correzioniPer(a, ctx) : [] })),
    scrittura: integrazione ? statoScritturaDns(integrazione) : { accesa: false, motivo: "Integrazione non trovata" },
    impostazioni: {
      dns_scrittura: !!integrazione?.dns_scrittura, dns_usa_winrm_dc: !!integrazione?.dns_usa_winrm_dc,
      dns_credential_id: integrazione?.dns_credential_id ?? null, haVoceWinrmDc: !!integrazione?.winrm_credential_id,
    },
    voluti,
  };
}

/** Le correzioni scelte per id, ricalcolate dai dati di ADESSO: quello che arriva dal browser è solo l'elenco degli id. */
export function correzioniScelte(integrationId: number, ids: readonly string[]): { trovate: Correzione[]; mancanti: string[]; motivi: string[] } {
  const tutte = new Map(vistaDnsAd(integrationId).anomalie.flatMap((a) => a.correzioni).map((c) => [c.id, c]));
  const trovate: Correzione[] = [];
  const mancanti: string[] = [];
  const motivi: string[] = [];
  const integrazione = getAdIntegrationById(integrationId);
  for (const id of ids) {
    if (id.startsWith(PREFISSO_VOCE_NUOVA)) {
      // Voce scritta a mano: i passi si ricostruiscono qui dall'id e passano subito dalla convalida, così un nome non ammesso si vede prima dell'anteprima.
      const zone = getZoneDnsAd(integrationId).map((z) => ({ nome: z.nome, inversa: z.inversa === 1, partizione: z.partizione as ZonaDns["partizione"] }));
      const nuova = integrazione ? voceNuovaDa(id, zone, integrazione.domain ?? "") : ({ ok: false, motivo: "Integrazione non trovata" } as const);
      const ammessi = integrazione ? ammessiDi(integrazione) : null;
      const rifiuto = nuova.ok && ammessi ? nuova.correzione.passi.map((p) => convalidaPasso(p, ammessi)).find((v) => !v.ok) : undefined;
      if (nuova.ok && !rifiuto) trovate.push(nuova.correzione);
      else { mancanti.push(id); motivi.push(!nuova.ok ? nuova.motivo : rifiuto && !rifiuto.ok ? rifiuto.motivo : "Voce non ammessa"); }
      continue;
    }
    const c = tutte.get(id);
    if (c) trovate.push(c);
    else mancanti.push(id);
  }
  return { trovate, mancanti, motivi };
}
