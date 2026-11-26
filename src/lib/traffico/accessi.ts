/**
 * Chi accede a cosa (23/11/2026, tappa 7 dei «dati in più»). **ZONA ROSSA: dati personali (nomi utente).**
 *
 * Il collector legge dalla copia del traffico il nome utente di un accesso Kerberos, SMB o LDAP e com'è andato
 * (`collector-traffico/collector/accessi.py`, prova di non-fuga in `tests/test_accessi.py`). Qui IPAM li tiene.
 *
 * Regole da non rompere (Riccardo, 23/11):
 * - **spento di serie**, per installazione: finché l'interruttore è spento IPAM non legge `/v1/accessi` e la rotta
 *   risponde come se non ci fosse niente; lo accende Riccardo;
 * - visibile **solo agli amministratori** (`requireAdmin` sulla rotta, scheda nascosta agli altri);
 * - tenuti **90 giorni**; **mai nei log** (nessun `console.*` con un nome utente), **mai negli export**, mai verso un modello;
 * - lo stesso accesso visto da più collector si prende al massimo, mai sommato.
 */
import type Database from "better-sqlite3";
import { getTenantSetting, setTenantSetting } from "@/lib/db-tenant";
import { nomiDegliIp, type NomeDiIp } from "./quadro";

export const GIORNI_ACCESSI = 90;
export const IMPOSTAZIONE_ACCESSI = "traffico_accessi_acceso";
export const PROTOCOLLI_ACCESSO = ["kerberos", "smb", "ldap"] as const;
export type ProtocolloAccesso = (typeof PROTOCOLLI_ACCESSO)[number];
const ESITI = new Set(["riuscito", "fallito"]);

export interface AccessoCollector {
  seq: number; inizio: string; client: string; server: string; protocollo: string; utente: string; dominio: string; esito: string; volte: number;
}

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
// Stampabile e corto: un nome con caratteri di controllo si scarta intero (come fa il collector).
const nomeBuono = (v: unknown, max: number, vuoto = false): v is string =>
  typeof v === "string" && v.length <= max && (vuoto || v.length > 0) && !/[\u0000-\u001f\u007f]/.test(v);

export function accessoValido(r: AccessoCollector): boolean {
  return (
    !!r && Number.isInteger(r.seq) && typeof r.inizio === "string" && DATA.test(r.inizio) &&
    nomeBuono(r.client, 64) && nomeBuono(r.server, 64) && (PROTOCOLLI_ACCESSO as readonly string[]).includes(r.protocollo) &&
    nomeBuono(r.utente, 128) && nomeBuono(r.dominio, 128, true) && ESITI.has(r.esito) &&
    Number.isInteger(r.volte) && r.volte > 0 && r.volte < 1e9
  );
}

/** L'interruttore dell'installazione. Assente = spento. */
export function accessiAccesi(): boolean {
  return getTenantSetting(IMPOSTAZIONE_ACCESSI) === "1";
}

export function impostaAccessi(acceso: boolean): void {
  setTenantSetting(IMPOSTAZIONE_ACCESSI, acceso ? "1" : "0");
}

/** Scrive una pagina letta dal collector. */
export function registraAccessi(d: Database.Database, collectorId: number, righe: AccessoCollector[]): void {
  const ins = d.prepare(`
    INSERT INTO traffico_accessi (giorno, client, server, protocollo, utente, dominio, esito, collector_id, volte, prima_vista, ultima_vista)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(giorno, client, server, protocollo, utente, dominio, esito, collector_id) DO UPDATE SET
      volte = traffico_accessi.volte + excluded.volte,
      prima_vista = MIN(traffico_accessi.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_accessi.ultima_vista, excluded.ultima_vista)`);
  for (const r of righe) {
    if (!accessoValido(r)) continue;
    ins.run(r.inizio.slice(0, 10), r.client, r.server, r.protocollo, r.utente, r.dominio, r.esito, collectorId, r.volte, r.inizio, r.inizio);
  }
}

export function sfoltisciAccessi(d: Database.Database): void {
  d.prepare("DELETE FROM traffico_accessi WHERE giorno < date('now', ?)").run(`-${GIORNI_ACCESSI} days`);
}

export interface RigaAccesso {
  utente: string; dominio: string; client: string; server: string; protocollo: ProtocolloAccesso;
  riusciti: number; falliti: number; prima_vista: string; ultima_vista: string;
}
export interface ElencoAccessi { righe: RigaAccesso[]; totale: number; pagina: number; perPagina: number; nomi: Record<string, NomeDiIp>; giorni: number }

const PER_PAGINA = 50;

/** Gli accessi del periodo, una riga per (utente, dominio, da, verso, protocollo). `cerca` su utente, dominio e indirizzi. */
export function elencoAccessi(d: Database.Database, opzioni: { giorni: number; cerca?: string; pagina?: number }): ElencoAccessi {
  const giorni = Math.max(1, Math.min(GIORNI_ACCESSI, Math.trunc(opzioni.giorni)));
  const pagina = Math.max(1, Math.trunc(opzioni.pagina ?? 1));
  const cerca = (opzioni.cerca ?? "").trim().slice(0, 100);
  const filtro = cerca ? "AND (utente LIKE @c ESCAPE '\\' OR dominio LIKE @c ESCAPE '\\' OR client LIKE @c ESCAPE '\\' OR server LIKE @c ESCAPE '\\')" : "";
  const parametri = { dal: `-${giorni - 1} days`, c: `%${cerca.replace(/[\\%_]/g, (x) => `\\${x}`)}%` };
  // per giorno ed esito il massimo fra i collector, poi la somma sui giorni
  const base = `
    SELECT utente, dominio, client, server, protocollo,
           SUM(CASE WHEN esito = 'riuscito' THEN volte ELSE 0 END) AS riusciti,
           SUM(CASE WHEN esito = 'fallito' THEN volte ELSE 0 END) AS falliti,
           MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
    FROM (
      SELECT giorno, utente, dominio, client, server, protocollo, esito, MAX(volte) AS volte, MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
      FROM traffico_accessi WHERE giorno >= date('now', @dal) ${filtro}
      GROUP BY giorno, utente, dominio, client, server, protocollo, esito)
    GROUP BY utente, dominio, client, server, protocollo`;
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(parametri) as { n: number }).n;
  const righe = d.prepare(`${base} ORDER BY ultima_vista DESC LIMIT ${PER_PAGINA} OFFSET ${(pagina - 1) * PER_PAGINA}`).all(parametri) as RigaAccesso[];
  return { righe, totale, pagina, perPagina: PER_PAGINA, nomi: nomiDegliIp([...righe.map((r) => r.client), ...righe.map((r) => r.server)]), giorni };
}
