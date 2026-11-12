/**
 * SNMP ha risposto = la credenziale funziona (Riccardo, 12/11/2026: «la generazione automatica degli apparati dentro
 * discovery se snmp li classifica o le credenziali funzionano e il sistema riesce ad accedere»). Su DTS 86 host
 * avevano risposto a SNMP nella scansione ma nessuno risultava con una credenziale validata: la scansione prova le
 * community della rete e non annotava quale voce dell'archivio aveva funzionato, quindi «Apparati creati da soli»
 * non aveva da dove partire. Qui la lettura riuscita diventa una riga `host_credentials` validata.
 *
 * Non prova niente di nuovo: annota una lettura già avvenuta. Una community di ripiego («public», quella scritta
 * nella rete) senza voce in archivio non si annota: l'apparato vuole una voce.
 */
import type Database from "better-sqlite3";
import { resolveCredentialsForDb } from "./resolve";
import { communityDb } from "./segreti";

const PORTA_SNMP = 161;

/** La voce d'archivio (dell'host o della rete) che ha quella community; `null` se è un ripiego senza voce. */
export function voceDellaCommunity(dbh: Database.Database, hostId: number, networkId: number, community: string): number | null {
  const cercata = community.trim();
  if (!cercata) return null;
  for (const c of resolveCredentialsForDb(dbh, { hostId, networkId }, "snmp", { registra: false })) {
    if (c.credential_id == null) continue;
    if (communityDb(dbh, c.credential_id)?.trim() === cercata) return c.credential_id;
  }
  return null;
}

/** Annota la lettura riuscita. Restituisce l'id della voce segnata, o `null` se non c'era una voce da segnare. */
export function segnaSnmpLetto(dbh: Database.Database, hostId: number, networkId: number, community: string | null | undefined): number | null {
  if (!community) return null;
  const voce = voceDellaCommunity(dbh, hostId, networkId, community);
  if (voce == null) return null;
  const max = dbh.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?").get(hostId) as { m: number };
  dbh.prepare(
    `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, 'snmp', ?, 1, datetime('now'), ?, 1)
     ON CONFLICT(host_id, credential_id, protocol_type, port) DO UPDATE SET validated = 1, validated_at = datetime('now')`,
  ).run(hostId, voce, PORTA_SNMP, max.m + 1);
  return voce;
}

export interface EsitoSnmpGiaLetti { letti: number; segnati: number; senza_voce: number; gia_validi: number; nomi: string[] }

/**
 * Le letture SNMP già in archivio (`hosts.snmp_data.community`), per non aspettare la prossima scansione.
 * Con `applica: false` conta soltanto.
 */
export function validaSnmpGiaLetti(dbh: Database.Database, opts: { applica: boolean }): EsitoSnmpGiaLetti {
  const righe = dbh.prepare(
    `SELECT h.id, h.network_id, h.ip, COALESCE(NULLIF(h.custom_name,''), NULLIF(h.hostname,''), h.ip) AS nome, h.snmp_data
       FROM hosts h WHERE h.snmp_data IS NOT NULL AND h.snmp_data NOT IN ('', '{}')`,
  ).all() as Array<{ id: number; network_id: number; ip: string; nome: string; snmp_data: string }>;
  const gia = dbh.prepare("SELECT 1 FROM host_credentials WHERE host_id = ? AND protocol_type = 'snmp' AND validated = 1 LIMIT 1");
  const esito: EsitoSnmpGiaLetti = { letti: righe.length, segnati: 0, senza_voce: 0, gia_validi: 0, nomi: [] };
  for (const r of righe) {
    if (gia.get(r.id)) { esito.gia_validi++; continue; }
    let community: string | null = null;
    try { community = (JSON.parse(r.snmp_data) as { community?: string | null }).community ?? null; } catch { community = null; }
    const voce = community ? voceDellaCommunity(dbh, r.id, r.network_id, community) : null;
    if (voce == null) { esito.senza_voce++; continue; }
    if (opts.applica) segnaSnmpLetto(dbh, r.id, r.network_id, community);
    esito.segnati++;
    esito.nomi.push(`${r.ip} ${r.nome}`);
  }
  return esito;
}
