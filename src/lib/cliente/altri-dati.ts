/**
 * Le altre fonti di dati della casa della vista cliente (censimento dell'11/11/2026 sul cliente 70791:
 * dati che DA-IPAM raccoglie già e che il cliente non vedeva). Solo letture.
 *
 *  - apparati comparsi in rete negli ultimi 7 giorni (`hosts.first_seen`);
 *  - apparati tenuti d'occhio e spenti (`hosts.known_host`), come nella Dashboard dell'amministratore;
 *  - quanto sono stati accesi gli apparati tenuti d'occhio negli ultimi 30 giorni (`status_history`);
 *  - sistemi operativi, con quelli che il produttore non aggiorna più (`wazuh_os`);
 *  - certificati scaduti o in scadenza (`servizi_rete.tls_json`).
 */
import type Database from "better-sqlite3";
import { nomeCategoria } from "./categorie";

function esiste(db: Database.Database, tabella: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabella);
}

function testo(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function nomeHost(r: { custom_name: string | null; hostname: string | null; ip: string }): string {
  return testo(r.custom_name) ?? testo(r.hostname) ?? r.ip;
}

// ── Apparati nuovi ─────────────────────────────────────────────────────────────────────────────

export const GIORNI_NUOVI = 7;

export interface ApparatoNuovo { ip: string; nome: string; cosa: string | null; vistoDal: string }

/** I più recenti prima, al più 30. `totale` li conta tutti. */
export function apparatiNuovi(db: Database.Database): { totale: number; apparati: ApparatoNuovo[] } {
  const righe = db.prepare(`
    SELECT ip, custom_name, hostname, attr_category, first_seen
    FROM hosts
    WHERE first_seen IS NOT NULL AND datetime(first_seen) >= datetime('now', '-${GIORNI_NUOVI} days')
    ORDER BY datetime(first_seen) DESC, ip
  `).all() as Array<{ ip: string; custom_name: string | null; hostname: string | null; attr_category: string | null; first_seen: string }>;
  return {
    totale: righe.length,
    apparati: righe.slice(0, 30).map((r) => ({ ip: r.ip, nome: nomeHost(r), cosa: nomeCategoria(testo(r.attr_category)), vistoDal: r.first_seen })),
  };
}

// ── Apparati tenuti d'occhio ───────────────────────────────────────────────────────────────────

export interface ApparatoImportante { ip: string; nome: string; vistoIl: string | null }

/** `null` se nessun apparato è segnato come da tenere d'occhio. */
export function importantiSpenti(db: Database.Database): { segnati: number; spenti: ApparatoImportante[] } | null {
  const segnati = (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE known_host = 1").get() as { n: number }).n;
  if (segnati === 0) return null;
  const righe = db.prepare(`
    SELECT ip, custom_name, hostname, last_seen
    FROM hosts
    WHERE known_host = 1 AND status = 'offline'
    ORDER BY datetime(last_seen) DESC, ip
  `).all() as Array<{ ip: string; custom_name: string | null; hostname: string | null; last_seen: string | null }>;
  return { segnati, spenti: righe.map((r) => ({ ip: r.ip, nome: nomeHost(r), vistoIl: testo(r.last_seen) })) };
}

// ── Disponibilità ──────────────────────────────────────────────────────────────────────────────

export const GIORNI_DISPONIBILITA = 30;
/** Sotto questo numero di controlli la percentuale non dice niente. */
const CONTROLLI_MINIMI = 20;

export interface DisponibilitaApparato { ip: string; nome: string; percento: number; controlli: number }

/**
 * Per ogni apparato tenuto d'occhio: la quota dei controlli in cui ha risposto, negli ultimi 30 giorni.
 * I peggiori prima. `null` se non c'è storico o nessun apparato è segnato.
 */
export function disponibilita(db: Database.Database): { media: number; apparati: DisponibilitaApparato[] } | null {
  if (!esiste(db, "status_history")) return null;
  const righe = db.prepare(`
    SELECT h.ip, h.custom_name, h.hostname,
      SUM(CASE WHEN s.status = 'online' THEN 1 ELSE 0 END) AS accesi,
      COUNT(*) AS controlli
    FROM status_history s
    JOIN hosts h ON h.id = s.host_id
    WHERE h.known_host = 1 AND s.status IN ('online', 'offline')
      AND s.checked_at >= datetime('now', '-${GIORNI_DISPONIBILITA} days')
    GROUP BY h.id
    HAVING COUNT(*) >= ${CONTROLLI_MINIMI}
  `).all() as Array<{ ip: string; custom_name: string | null; hostname: string | null; accesi: number; controlli: number }>;
  if (righe.length === 0) return null;
  const apparati = righe
    .map((r) => ({ ip: r.ip, nome: nomeHost(r), percento: percento(r.accesi, r.controlli), controlli: r.controlli }))
    .sort((a, b) => a.percento - b.percento || a.nome.localeCompare(b.nome, "it"));
  const media = apparati.reduce((n, a) => n + a.percento, 0) / apparati.length;
  return { media: Math.round(media * 10) / 10, apparati };
}

/** Pura. Una cifra decimale; il 100 si dà solo se non è mancato nessun controllo. */
export function percento(accesi: number, controlli: number): number {
  if (controlli <= 0) return 0;
  const p = Math.floor((accesi / controlli) * 1000) / 10;
  return accesi < controlli ? Math.min(p, 99.9) : 100;
}

// ── Sistemi operativi ──────────────────────────────────────────────────────────────────────────

export interface SistemaOperativo { nome: string; macchine: number; fuoriSupporto: boolean }

/**
 * Pura. Il nome da mostrare e se il produttore ha smesso di aggiornarlo. Regole prudenti, scritte
 * l'11/11/2026: Windows 10 (fine degli aggiornamenti 14/10/2025), Windows 7, 8 e 8.1, Windows Server
 * 2012 e precedenti, Ubuntu fino alla 20.04 (supporto ordinario finito a maggio 2025), Debian fino
 * alla 11 (fine del supporto esteso 31/08/2026). Ciò che non è in elenco non si segna: meglio un
 * avviso in meno che uno falso.
 */
export function sistemaDa(osName: string | null, osVersion: string | null): { nome: string; fuoriSupporto: boolean } {
  const nome = testo(osName) ?? "Sconosciuto";
  const versione = testo(osVersion) ?? "";
  const win = /^Microsoft Windows (Server )?(\d+(?:\.\d)?(?: R2)?)/i.exec(nome);
  if (win) {
    const server = !!win[1];
    const numero = win[2] ?? "";
    const anno = Number(numero.slice(0, 4));
    const fuori = server ? anno > 0 && anno <= 2012 : ["7", "8", "8.1", "10"].includes(numero);
    return { nome: `Windows ${server ? "Server " : ""}${numero}`, fuoriSupporto: fuori };
  }
  const maggiore = Number((/^(\d+)(?:\.(\d+))?/.exec(versione) ?? [])[1] ?? NaN);
  if (/^ubuntu/i.test(nome)) {
    const v = /^(\d+\.\d+)/.exec(versione)?.[1];
    return { nome: v ? `Ubuntu ${v}` : "Ubuntu", fuoriSupporto: Number.isFinite(maggiore) && maggiore <= 20 };
  }
  if (/^debian/i.test(nome)) {
    return { nome: Number.isFinite(maggiore) ? `Debian ${maggiore}` : "Debian", fuoriSupporto: Number.isFinite(maggiore) && maggiore <= 11 };
  }
  return { nome, fuoriSupporto: false };
}

/** I più diffusi prima. `null` se non c'è l'inventario dei sistemi. */
export function sistemiOperativi(db: Database.Database): { macchine: number; fuoriSupporto: number; sistemi: SistemaOperativo[] } | null {
  if (!esiste(db, "wazuh_os")) return null;
  const righe = db.prepare("SELECT os_name, os_version, COUNT(*) AS n FROM wazuh_os GROUP BY os_name, os_version").all() as Array<{
    os_name: string | null; os_version: string | null; n: number;
  }>;
  if (righe.length === 0) return null;
  const per = new Map<string, SistemaOperativo>();
  for (const r of righe) {
    const s = sistemaDa(r.os_name, r.os_version);
    const gia = per.get(s.nome) ?? { nome: s.nome, macchine: 0, fuoriSupporto: s.fuoriSupporto };
    gia.macchine += r.n;
    gia.fuoriSupporto = gia.fuoriSupporto || s.fuoriSupporto;
    per.set(s.nome, gia);
  }
  const sistemi = [...per.values()].sort((a, b) => b.macchine - a.macchine || a.nome.localeCompare(b.nome, "it"));
  return {
    macchine: sistemi.reduce((n, s) => n + s.macchine, 0),
    fuoriSupporto: sistemi.filter((s) => s.fuoriSupporto).reduce((n, s) => n + s.macchine, 0),
    sistemi,
  };
}

// ── Certificati ────────────────────────────────────────────────────────────────────────────────

export const GIORNI_SCADENZA = 30;

export interface Certificato { dove: string; nome: string; scade: string; giorni: number; scaduto: boolean }

/**
 * Certificati scaduti o che scadono entro 30 giorni. Quelli firmati da sé (quasi sempre il
 * certificato di fabbrica di un apparato) non contano: scadono senza che nessuno li abbia mai
 * rinnovati, e riempirebbero l'elenco. I più urgenti prima, al più 30.
 * `null` se i servizi di rete non sono stati rilevati.
 */
export function certificati(db: Database.Database, ora: Date = new Date()): { controllati: number; scaduti: number; inScadenza: number; elenco: Certificato[] } | null {
  if (!esiste(db, "servizi_rete")) return null;
  const righe = db.prepare(`
    SELECT s.porta, s.tls_json, h.ip, h.custom_name, h.hostname
    FROM servizi_rete s
    JOIN hosts h ON h.id = s.host_id
    WHERE s.tls_json IS NOT NULL
  `).all() as Array<{ porta: number; tls_json: string; ip: string; custom_name: string | null; hostname: string | null }>;
  if (righe.length === 0) return null;
  const adesso = ora.getTime();
  const elenco: Certificato[] = [];
  let controllati = 0;
  for (const r of righe) {
    let tls: { not_after?: unknown; self_signed?: unknown; subject_cn?: unknown };
    try {
      tls = JSON.parse(r.tls_json) as typeof tls;
    } catch {
      continue;
    }
    if (tls.self_signed === true || typeof tls.not_after !== "string") continue;
    const scade = Date.parse(`${tls.not_after.replace(" ", "T")}Z`);
    if (Number.isNaN(scade)) continue;
    controllati += 1;
    const giorni = Math.floor((scade - adesso) / 86_400_000);
    if (giorni > GIORNI_SCADENZA) continue;
    elenco.push({
      dove: `${nomeHost(r)}:${r.porta}`,
      nome: typeof tls.subject_cn === "string" && tls.subject_cn.trim() ? tls.subject_cn.trim() : nomeHost(r),
      scade: tls.not_after,
      giorni,
      scaduto: scade < adesso,
    });
  }
  elenco.sort((a, b) => a.giorni - b.giorni || a.dove.localeCompare(b.dove, "it"));
  return {
    controllati,
    scaduti: elenco.filter((c) => c.scaduto).length,
    inScadenza: elenco.filter((c) => !c.scaduto).length,
    elenco: elenco.slice(0, 30),
  };
}
