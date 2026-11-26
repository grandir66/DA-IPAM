/**
 * Agganciare le macchine ESET agli host di DA-IPAM (17/11/2026; piano DA-Link
 * `2026-11-16-eset-verso-da-ipam.md`, Task 3; scelta di Riccardo del 16/11).
 *
 * Nell'ordine: MAC di una scheda vera, poi seriale, poi nome senza dominio. Zero candidati = si
 * prova il passo dopo. Più candidati per NOME = «da abbinare» (non si sceglie a caso fra due host).
 * Più candidati con lo stesso MAC o lo stesso seriale sono la stessa macchina censita più volte
 * (cavo e wifi, un indirizzo vecchio): va all'host visto più di recente (Riccardo, 17/11/2026,
 * «Sì, al più recente»; sulla 533 erano 6 macchine su 31). Senza una data su nessuno resta ambigua. Una macchina che non si aggancia resta nell'elenco «da abbinare» e non crea
 * host. L'aggancio fatto a mano vince e il giro non lo tocca.
 */
import type Database from "better-sqlite3";

export type MotivoAbbinamento = "mac" | "seriale" | "nome" | "nessuno" | "ambiguo" | "mano";

export interface HostPerAbbinare { id: number; mac: string | null; nome: string | null; nome2: string | null; seriale: string | null; visto?: string | null }
export interface MacchinaPerAbbinare { uuid: string; nome: string; hostname: string | null; mac: string[]; seriale: string | null }
export interface Abbinamento { host_id: number | null; per: MotivoAbbinamento }

/** Seriali che non identificano niente: segnaposto dei produttori e valori troppo corti. */
const SERIALE_FINTO = /^(0+|none|n\/?a|default string|to be filled.*|system serial number|not specified|unknown|123456789|\.+)$/i;

export function serialeUtile(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().toLowerCase();
  return v.length >= 5 && !SERIALE_FINTO.test(v) ? v : null;
}

/** «PC-01.dominio.lan» e «pc-01» sono lo stesso nome; un IP o un nome vuoto non lo sono di nessuno. */
export function nomeCorto(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().toLowerCase();
  if (!v || /^[0-9.:]+$/.test(v)) return null;
  const corto = v.split(".")[0];
  return corto.length >= 2 ? corto : null;
}

const macNorm = (m: string | null | undefined): string | null => {
  const v = (m ?? "").trim().toLowerCase().replace(/-/g, ":");
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(v) && v !== "00:00:00:00:00:00" ? v : null;
};

interface Indici { perMac: Map<string, Set<number>>; perSeriale: Map<string, Set<number>>; perNome: Map<string, Set<number>>; visto: Map<number, string> }

function metti(m: Map<string, Set<number>>, k: string | null, id: number): void {
  if (!k) return;
  const s = m.get(k) ?? new Set<number>();
  s.add(id);
  m.set(k, s);
}

/** `macInPiu`: MAC noti per un host da altre fonti (l'agente Wazuh), stesso formato. */
export function indiciHost(hosts: HostPerAbbinare[], macInPiu: Array<{ host_id: number; mac: string | null }> = []): Indici {
  const i: Indici = { perMac: new Map(), perSeriale: new Map(), perNome: new Map(), visto: new Map() };
  for (const h of hosts) {
    if (h.visto) i.visto.set(h.id, h.visto.replace(" ", "T"));
    metti(i.perMac, macNorm(h.mac), h.id);
    metti(i.perSeriale, serialeUtile(h.seriale), h.id);
    metti(i.perNome, nomeCorto(h.nome), h.id);
    metti(i.perNome, nomeCorto(h.nome2), h.id);
  }
  for (const x of macInPiu) metti(i.perMac, macNorm(x.mac), x.host_id);
  return i;
}

/** Funzione pura: a quale host va la macchina, e per cosa. */
export function abbina(m: MacchinaPerAbbinare, i: Indici): Abbinamento {
  const passi: Array<[MotivoAbbinamento, Array<string | null>, Map<string, Set<number>>]> = [
    ["mac", m.mac.map(macNorm), i.perMac],
    ["seriale", [serialeUtile(m.seriale)], i.perSeriale],
    ["nome", [nomeCorto(m.nome), nomeCorto(m.hostname)], i.perNome],
  ];
  for (const [per, chiavi, indice] of passi) {
    const candidati = new Set<number>();
    for (const k of chiavi) for (const id of (k ? indice.get(k) : undefined) ?? []) candidati.add(id);
    if (candidati.size === 1) return { host_id: [...candidati][0], per };
    if (candidati.size > 1) {
      // Stesso MAC o stesso seriale = stessa macchina: vale l'host visto più di recente.
      if (per !== "nome") {
        const datati = [...candidati].filter((id) => i.visto.has(id)).sort((a, b) => (i.visto.get(b) as string).localeCompare(i.visto.get(a) as string) || a - b);
        if (datati.length > 0) return { host_id: datati[0], per };
      }
      return { host_id: null, per: "ambiguo" };
    }
  }
  return { host_id: null, per: "nessuno" };
}

export interface ContiAbbinamento { agganciate: number; da_abbinare: number; a_mano: number; per: Record<string, number> }

/** Ricalcola gli agganci non fatti a mano. Si chiama dopo ogni copia e dopo un aggancio a mano. */
export function riabbinaEset(db: Database.Database, ora: Date = new Date()): ContiAbbinamento {
  const hosts = db.prepare("SELECT id, mac, hostname AS nome, custom_name AS nome2, serial_number AS seriale, last_seen AS visto FROM hosts").all() as HostPerAbbinare[];
  let wazuh: Array<{ host_id: number; mac: string | null }> = [];
  try {
    wazuh = db.prepare("SELECT host_id, mac FROM wazuh_agent WHERE host_id IS NOT NULL AND mac IS NOT NULL").all() as typeof wazuh;
  } catch {
    wazuh = []; // istanza senza Wazuh: la tabella può non esserci
  }
  const indici = indiciHost(hosts, wazuh);
  const esistenti = new Set(hosts.map((h) => h.id));
  const aMano = new Map((db.prepare("SELECT macchina_uuid, host_id FROM eset_abbinamento WHERE a_mano = 1").all() as Array<{ macchina_uuid: string; host_id: number | null }>).map((r) => [r.macchina_uuid, r.host_id]));
  const macchine = db.prepare("SELECT uuid, nome, hostname, mac, seriale FROM eset_macchina").all() as Array<{ uuid: string; nome: string; hostname: string | null; mac: string; seriale: string | null }>;
  const conti: ContiAbbinamento = { agganciate: 0, da_abbinare: 0, a_mano: 0, per: {} };
  const quando = ora.toISOString();
  const scrivi = db.prepare(
    `INSERT INTO eset_abbinamento (macchina_uuid, host_id, per, a_mano, quando) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(macchina_uuid) DO UPDATE SET host_id = excluded.host_id, per = excluded.per, quando = excluded.quando
     WHERE eset_abbinamento.a_mano = 0`,
  );
  db.transaction(() => {
    for (const m of macchine) {
      if (aMano.has(m.uuid)) {
        const h = aMano.get(m.uuid) ?? null;
        // Aggancio a mano verso un host che non c'è più: torna all'automatico.
        if (h === null || esistenti.has(h)) {
          conti.a_mano++;
          if (h === null) conti.da_abbinare++;
          else conti.agganciate++;
          continue;
        }
        db.prepare("UPDATE eset_abbinamento SET a_mano = 0 WHERE macchina_uuid = ?").run(m.uuid);
      }
      let mac: string[] = [];
      try {
        const v: unknown = JSON.parse(m.mac);
        if (Array.isArray(v)) mac = v.filter((x): x is string => typeof x === "string");
      } catch {
        mac = [];
      }
      const a = abbina({ uuid: m.uuid, nome: m.nome, hostname: m.hostname, mac, seriale: m.seriale }, indici);
      scrivi.run(m.uuid, a.host_id, a.per, quando);
      conti.per[a.per] = (conti.per[a.per] ?? 0) + 1;
      if (a.host_id === null) conti.da_abbinare++;
      else conti.agganciate++;
    }
  })();
  return conti;
}

/** Aggancio deciso da una persona: `hostId` null = «questa macchina non è fra gli host». */
export function abbinaAMano(db: Database.Database, uuid: string, hostId: number | null, ora: Date = new Date()): boolean {
  if (!db.prepare("SELECT 1 FROM eset_macchina WHERE uuid = ?").get(uuid)) return false;
  if (hostId !== null && !db.prepare("SELECT 1 FROM hosts WHERE id = ?").get(hostId)) return false;
  db.prepare(
    `INSERT INTO eset_abbinamento (macchina_uuid, host_id, per, a_mano, quando) VALUES (?, ?, 'mano', 1, ?)
     ON CONFLICT(macchina_uuid) DO UPDATE SET host_id = excluded.host_id, per = 'mano', a_mano = 1, quando = excluded.quando`,
  ).run(uuid, hostId, ora.toISOString());
  return true;
}

/** Toglie l'aggancio a mano: la macchina torna all'automatico al prossimo ricalcolo. */
export function togliAbbinamentoAMano(db: Database.Database, uuid: string): void {
  db.prepare("UPDATE eset_abbinamento SET a_mano = 0 WHERE macchina_uuid = ?").run(uuid);
  riabbinaEset(db);
}
