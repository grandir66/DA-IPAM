/**
 * Cosa vede il cliente in DATIA MONITORING (Riccardo, 13/11/2026: «apparati, famiglie»): l'amministratore
 * nasconde famiglie e apparati e dà agli apparati il nome che il cliente legge. Senza una riga, tutto è
 * visibile col nome di Zabbix. Un apparato nascosto sparisce del tutto: elenco, conti, frase, problemi, KPI.
 *
 * Funzioni su un `Database` passato: la pagina e la rotta gli danno quello del cliente in sessione.
 */
import type Database from "better-sqlite3";
import { assicuraTabelleZabbixLettura } from "@/lib/db-tenant-schema";

export interface ImpostazioniMonitoring {
  famiglieNascoste: ReadonlySet<string>;
  hostNascosti: ReadonlySet<string>;
  /** hostid → nome per il cliente. */
  nomi: ReadonlyMap<string, string>;
}

export const IMPOSTAZIONI_VUOTE: ImpostazioniMonitoring = { famiglieNascoste: new Set(), hostNascosti: new Set(), nomi: new Map() };

export const FORMA_HOSTID = /^\d{1,20}$/;
export const FORMA_FAMIGLIA = /^[a-z_]{1,30}$/;
export const NOME_MASSIMO = 80;

interface Riga {
  tipo: "famiglia" | "host";
  chiave: string;
  visibile: number;
  nome_cliente: string | null;
}

export function leggiImpostazioniMonitoring(db: Database.Database): ImpostazioniMonitoring {
  assicuraTabelleZabbixLettura(db);
  const righe = db.prepare("SELECT tipo, chiave, visibile, nome_cliente FROM monitoring_visibilita").all() as Riga[];
  const famiglieNascoste = new Set<string>();
  const hostNascosti = new Set<string>();
  const nomi = new Map<string, string>();
  for (const r of righe) {
    if (r.tipo === "famiglia" && r.visibile === 0) famiglieNascoste.add(r.chiave);
    if (r.tipo === "host" && r.visibile === 0) hostNascosti.add(r.chiave);
    if (r.tipo === "host" && r.nome_cliente && r.nome_cliente.trim()) nomi.set(r.chiave, r.nome_cliente.trim());
  }
  return { famiglieNascoste, hostNascosti, nomi };
}

export interface VoceImpostazione {
  tipo: "famiglia" | "host";
  chiave: string;
  visibile: boolean;
  /** Solo per gli apparati; vuoto o null = il nome di Zabbix. */
  nomeCliente?: string | null;
}

export type EsitoImpostazione = { ok: true } | { ok: false; errore: string };

/** Scrive una voce. Una voce che torna al valore di serie (visibile, senza nome) si toglie. */
export function salvaImpostazioneMonitoring(db: Database.Database, v: VoceImpostazione, chi: string): EsitoImpostazione {
  if (v.tipo === "host" && !FORMA_HOSTID.test(v.chiave)) return { ok: false, errore: "Apparato non valido" };
  if (v.tipo === "famiglia" && !FORMA_FAMIGLIA.test(v.chiave)) return { ok: false, errore: "Famiglia non valida" };
  if (v.tipo !== "host" && v.tipo !== "famiglia") return { ok: false, errore: "Tipo non valido" };
  const nome = v.tipo === "host" ? (v.nomeCliente ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  if (nome.length > NOME_MASSIMO) return { ok: false, errore: `Il nome per il cliente può avere al più ${NOME_MASSIMO} caratteri` };
  assicuraTabelleZabbixLettura(db);
  if (v.visibile && !nome) {
    db.prepare("DELETE FROM monitoring_visibilita WHERE tipo = ? AND chiave = ?").run(v.tipo, v.chiave);
    return { ok: true };
  }
  db.prepare(
    `INSERT INTO monitoring_visibilita (tipo, chiave, visibile, nome_cliente, aggiornato_il, aggiornato_da)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(tipo, chiave) DO UPDATE SET visibile = excluded.visibile, nome_cliente = excluded.nome_cliente,
       aggiornato_il = excluded.aggiornato_il, aggiornato_da = excluded.aggiornato_da`,
  ).run(v.tipo, v.chiave, v.visibile ? 1 : 0, nome || null, chi);
  return { ok: true };
}
