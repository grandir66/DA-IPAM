/**
 * L'ultimo utente scritto nella descrizione del computer di AD (Riccardo, 23/11/2026: «per i pc in AD dovrebbe essere
 * relativamente facile»).
 *
 * Molti domini hanno uno script di accesso che a ogni logon riscrive la descrizione del computer così:
 * `donato - 23/11/2026 - OS: Microsoft Windows 11 Pro sp 0 - IP: 192.168.4.174 - HP EliteDesk`. Sul 70791 ce l'hanno
 * 35 PC di AD su 42, fresca sui PC vivi, mentre gli eventi di Wazuh vedono i PC solo dove c'è l'agente: per questo la
 * colonna «Utente abituale» restava vuota su PC-APADULA, NB-SMANCINI, PC-SORAGNI e altri (misura del 23/11).
 *
 * È l'ULTIMO utente, non il più frequente: vale solo quando gli accessi non bastano, e solo se la data sta nella finestra.
 * Una descrizione d'altro formato non si interpreta (niente ripieghi: «Server di stampa» non è un utente).
 */
import type Database from "better-sqlite3";
import { normalizzaAccount } from "./account";

export interface DescrizioneAd {
  account: string;
  /** «YYYY-MM-DD». */
  giorno: string;
  ip: string | null;
}

/** «utente - gg/mm/aaaa - … [IP: a.b.c.d] …» → account, giorno, IP; altro formato o data impossibile → null. */
export function leggiDescrizioneAd(descrizione: unknown): DescrizioneAd | null {
  const testo = Array.isArray(descrizione) ? descrizione.find((x) => typeof x === "string") : descrizione;
  if (typeof testo !== "string") return null;
  const m = /^\s*([^\s]+)\s+-\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(testo);
  if (!m) return null;
  const account = normalizzaAccount(m[1]);
  if (!account) return null;
  const [g, me, a] = [Number(m[2]), Number(m[3]), Number(m[4])];
  const d = new Date(Date.UTC(a, me - 1, g));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== me - 1 || d.getUTCDate() !== g) return null;
  const ip = /\bIP:\s*(\d{1,3}(?:\.\d{1,3}){3})\b/i.exec(testo)?.[1] ?? null;
  return { account, giorno: d.toISOString().slice(0, 10), ip };
}

export interface UltimoAccessoAd extends DescrizioneAd {
  hostId: number;
  computer: string;
}

/**
 * Per ogni host, l'ultimo utente scritto in AD nella finestra di `giorni`. Solo computer abilitati e non server.
 * Host: quello legato al computer di AD; se non è legato, l'unico host con l'IP della descrizione (o dell'oggetto AD).
 * Due computer sullo stesso host: vince la data più recente.
 */
export function ultimiAccessiAd(db: Database.Database, giorni: number, oggi = new Date()): Map<number, UltimoAccessoAd> {
  const limite = new Date(oggi.getTime() - giorni * 86_400_000).toISOString().slice(0, 10);
  const perIp = new Map<string, number | null>();
  for (const r of db.prepare("SELECT id, ip FROM hosts").all() as Array<{ id: number; ip: string }>) perIp.set(r.ip, perIp.has(r.ip) ? null : r.id);
  const out = new Map<number, UltimoAccessoAd>();
  const righe = db.prepare(
    `SELECT sam_account_name AS nome, host_id, ip_address, raw_data FROM ad_computers
     WHERE enabled = 1 AND COALESCE(operating_system, '') NOT LIKE '%Server%' AND raw_data IS NOT NULL`,
  ).all() as Array<{ nome: string; host_id: number | null; ip_address: string | null; raw_data: string }>;
  for (const r of righe) {
    let descr: DescrizioneAd | null = null;
    try {
      descr = leggiDescrizioneAd((JSON.parse(r.raw_data) as { description?: unknown }).description);
    } catch {
      continue;
    }
    if (!descr || descr.giorno < limite) continue;
    const hostId = r.host_id ?? (descr.ip ? perIp.get(descr.ip) ?? null : null) ?? (r.ip_address ? perIp.get(r.ip_address) ?? null : null);
    if (hostId === null) continue;
    const prima = out.get(hostId);
    if (prima && prima.giorno >= descr.giorno) continue;
    out.set(hostId, { ...descr, hostId, computer: r.nome.replace(/\$$/, "") });
  }
  return out;
}
