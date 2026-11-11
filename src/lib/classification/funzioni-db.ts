/**
 * Le funzioni degli apparati nel database del cliente: lettura dei segnali, riempimento, lettura per le pagine.
 * Le regole stanno in `funzioni.ts` (modulo puro). La tabella nasce qui al primo uso, come `dc_evento`.
 *
 * `a_mano`: 0 = trovata dal sistema (si aggiorna e si toglie da sola), 1 = messa da una persona (non si tocca),
 * -1 = tolta da una persona (resta come segno, così il sistema non la rimette).
 */
import type Database from "better-sqlite3";
import { eFunzione, funzioniDi, type Funzione, type SegnaliFunzioni } from "./funzioni";

export function assicuraTabellaFunzioni(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS host_funzioni (
    host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    funzione TEXT NOT NULL,
    origine TEXT NOT NULL,
    a_mano INTEGER NOT NULL DEFAULT 0,
    visto_il TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (host_id, funzione)
  )`);
}

function esiste(db: Database.Database, tabella: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabella);
}

function porteDa(json: string | null): number[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json) as unknown;
    if (!Array.isArray(p)) return [];
    return p.map((x) => Number((x as { port?: unknown })?.port)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function ruoliDa(json: string | null): string[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json) as unknown;
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function corto(nome: string | null | undefined): string {
  return (nome ?? "").trim().toLowerCase().split(".")[0];
}

export interface HostConSegnali { id: number; ip: string; nome: string; segnali: SegnaliFunzioni }

/** I segnali di tutti gli host del cliente, letti una volta sola (niente una query per host). */
export function segnaliDegliHost(db: Database.Database): HostConSegnali[] {
  const hosts = db.prepare(
    "SELECT id, ip, hostname, custom_name, classification, open_ports, server_roles FROM hosts",
  ).all() as Array<{ id: number; ip: string; hostname: string | null; custom_name: string | null; classification: string | null; open_ports: string | null; server_roles: string | null }>;

  const servizi = new Map<number, string[]>();
  if (esiste(db, "wazuh_service") && esiste(db, "wazuh_agent")) {
    const righe = db.prepare(
      `SELECT a.host_id AS host_id, s.service_id AS nome
       FROM wazuh_service s JOIN wazuh_agent a ON a.agent_id = s.agent_id
       WHERE a.host_id IS NOT NULL AND COALESCE(s.process_pid, 0) > 0`,
    ).all() as Array<{ host_id: number; nome: string }>;
    for (const r of righe) {
      const elenco = servizi.get(r.host_id) ?? [];
      elenco.push(r.nome);
      servizi.set(r.host_id, elenco);
    }
  }
  const dc = new Set<string>();
  if (esiste(db, "dc_lettura")) {
    for (const r of db.prepare("SELECT dc FROM dc_lettura").all() as Array<{ dc: string }>) dc.add(corto(r.dc));
  }
  return hosts.map((h) => ({
    id: h.id,
    ip: h.ip,
    nome: h.custom_name?.trim() || h.hostname?.trim() || h.ip,
    segnali: {
      classe: h.classification,
      porte: porteDa(h.open_ports),
      servizi: servizi.get(h.id) ?? [],
      serverDiDominio: (!!corto(h.hostname) && dc.has(corto(h.hostname))) || (!!corto(h.custom_name) && dc.has(corto(h.custom_name))),
      ruoli: ruoliDa(h.server_roles),
    },
  }));
}

export interface RigaFunzione { host_id: number; ip: string; nome: string; funzione: Funzione; origine: string }

/**
 * Ricalcola le funzioni trovate dal sistema. Senza `applica` non scrive e rende solo che cosa scriverebbe.
 * Le righe messe o tolte a mano non si toccano; quelle del sistema che non valgono più si tolgono.
 */
export function ricalcolaFunzioni(db: Database.Database, opts: { applica: boolean }): { trovate: RigaFunzione[]; scritte: number; tolte: number } {
  assicuraTabellaFunzioni(db);
  const trovate: RigaFunzione[] = [];
  for (const h of segnaliDegliHost(db)) {
    for (const f of funzioniDi(h.segnali)) trovate.push({ host_id: h.id, ip: h.ip, nome: h.nome, funzione: f.funzione, origine: f.origine });
  }
  if (!opts.applica) return { trovate, scritte: 0, tolte: 0 };

  const chiavi = new Set(trovate.map((t) => `${t.host_id}|${t.funzione}`));
  let scritte = 0;
  let tolte = 0;
  db.transaction(() => {
    const vecchie = db.prepare("SELECT host_id, funzione FROM host_funzioni WHERE a_mano = 0").all() as Array<{ host_id: number; funzione: string }>;
    const togli = db.prepare("DELETE FROM host_funzioni WHERE host_id = ? AND funzione = ? AND a_mano = 0");
    for (const v of vecchie) {
      if (!chiavi.has(`${v.host_id}|${v.funzione}`)) tolte += togli.run(v.host_id, v.funzione).changes;
    }
    // Una riga messa o tolta a mano (a_mano diverso da 0) resta com'è: il WHERE dell'aggiornamento la salta.
    const metti = db.prepare(
      `INSERT INTO host_funzioni (host_id, funzione, origine, a_mano, visto_il) VALUES (?, ?, ?, 0, datetime('now'))
       ON CONFLICT(host_id, funzione) DO UPDATE SET origine = excluded.origine, visto_il = excluded.visto_il WHERE host_funzioni.a_mano = 0`,
    );
    for (const t of trovate) scritte += metti.run(t.host_id, t.funzione, t.origine).changes;
  })();
  return { trovate, scritte, tolte };
}

export interface FunzioneDellHost { funzione: Funzione; origine: string; a_mano: boolean }

/** Le funzioni da mostrare, per host. Quelle tolte a mano non compaiono. `networkId` restringe a una rete. */
export function funzioniPerHost(db: Database.Database, networkId?: number): Record<number, FunzioneDellHost[]> {
  assicuraTabellaFunzioni(db);
  const righe = (networkId != null
    ? db.prepare("SELECT f.host_id, f.funzione, f.origine, f.a_mano FROM host_funzioni f JOIN hosts h ON h.id = f.host_id WHERE f.a_mano >= 0 AND h.network_id = ?").all(networkId)
    : db.prepare("SELECT host_id, funzione, origine, a_mano FROM host_funzioni WHERE a_mano >= 0").all()
  ) as Array<{ host_id: number; funzione: string; origine: string; a_mano: number }>;
  const out: Record<number, FunzioneDellHost[]> = {};
  for (const r of righe) {
    if (!eFunzione(r.funzione)) continue;
    (out[r.host_id] ??= []).push({ funzione: r.funzione, origine: r.origine, a_mano: r.a_mano === 1 });
  }
  return out;
}

export type AzioneFunzione = "metti" | "togli" | "automatica";

/**
 * La scelta di una persona su una funzione, per uno o più host (11/11/2026, passo 4).
 * - `metti`: la funzione c'è, e il sistema non la toglie più;
 * - `togli`: la funzione non c'è, e il sistema non la rimette (resta il segno `a_mano = -1`);
 * - `automatica`: si toglie la scelta della persona e decide di nuovo il sistema, subito.
 * Rende quante righe ha toccato.
 */
export function impostaFunzioneAMano(db: Database.Database, hostIds: readonly number[], funzione: Funzione, azione: AzioneFunzione): number {
  assicuraTabellaFunzioni(db);
  let toccate = 0;
  db.transaction(() => {
    if (azione === "automatica") {
      const via = db.prepare("DELETE FROM host_funzioni WHERE host_id = ? AND funzione = ? AND a_mano != 0");
      for (const id of hostIds) toccate += via.run(id, funzione).changes;
      return;
    }
    const valore = azione === "metti" ? 1 : -1;
    const scrivi = db.prepare(
      `INSERT INTO host_funzioni (host_id, funzione, origine, a_mano, visto_il) VALUES (?, ?, 'a mano', ?, datetime('now'))
       ON CONFLICT(host_id, funzione) DO UPDATE SET origine = 'a mano', a_mano = excluded.a_mano, visto_il = excluded.visto_il`,
    );
    const esisteHost = db.prepare("SELECT 1 FROM hosts WHERE id = ?");
    for (const id of hostIds) {
      if (!esisteHost.get(id)) continue;
      toccate += scrivi.run(id, funzione, valore).changes;
    }
  })();
  // Tornata automatica: il sistema rimette subito ciò che trova, senza aspettare la prossima scansione.
  if (azione === "automatica") ricalcolaFunzioni(db, { applica: true });
  return toccate;
}
