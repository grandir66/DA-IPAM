/**
 * «Metti in monitoraggio» lato server: dall'host di DA-IPAM all'esito del centro
 * (13/11/2026, tappa C di DATIA MONITORING). Funzioni su un `Database` passato: le rotte
 * danno quello del tenant della sessione, le prove uno in memoria.
 */
import type Database from "better-sqlite3";
import { normalizzaBase } from "./client";
import { chiaveScrittura, leggiConfigLettura } from "./config";
import { famigliaDaClassificazione } from "./apparati";
import {
  cambiaFamiglia,
  cambiaModelli,
  comandoAgente,
  mettiInMonitoraggio,
  type CambioModelli,
  type EsitoAgente,
  type EsitoFamiglia,
  type EsitoModelli,
  type EsitoScrittura,
  type OggettoDaMettere,
  type OpzioniScrittura,
} from "./scrittura";
import { ErroreLettura, type TrasportoPost } from "./trasporto";

export type EsitoInserimento =
  | { ok: true; esito: EsitoScrittura }
  | { ok: false; status: 400 | 404 | 409 | 502; errore: string };

interface RigaHost {
  ip: string;
  mac: string | null;
  hostname: string | null;
  custom_name: string | null;
  classification: string | null;
  vendor: string | null;
  os_info: string | null;
  model: string | null;
  open_ports: string | null;
  snmp_data: string | null;
}

/** L'host come lo vuole il centro, o null se non esiste. */
export function oggettoDaHost(db: Database.Database, hostId: number): OggettoDaMettere | null {
  const r = db
    .prepare(
      `SELECT ip, mac, hostname, custom_name, classification, vendor, os_info, model, open_ports, snmp_data
       FROM hosts WHERE id = ?`,
    )
    .get(hostId) as RigaHost | undefined;
  if (!r || !r.ip) return null;
  // Lo stesso apparato visto da più reti (Domarc, 13/11: `drive.domarc.it` .4.22 e `DA-SYN`
  // .40.22 sono un NAS solo): il centro deve saperlo per non creare un secondo host.
  const altri = (
    db
      .prepare(
        `SELECT ip FROM hosts WHERE physical_device_id IS NOT NULL AND id <> ?
           AND physical_device_id = (SELECT physical_device_id FROM hosts WHERE id = ?) AND ip <> ''
         LIMIT 16`,
      )
      .all(hostId, hostId) as Array<{ ip: string }>
  ).map((x) => x.ip);
  return {
    altriIp: altri,
    ip: r.ip,
    mac: r.mac,
    hostname: r.hostname,
    customName: r.custom_name,
    classification: r.classification,
    vendor: r.vendor,
    osInfo: r.os_info,
    model: r.model,
    openPorts: r.open_ports,
    snmpData: r.snmp_data,
  };
}

export interface DipendenzeInserimento {
  db: Database.Database;
  acquistato: () => boolean;
  trasportoPost: (base: URL, chiave: string, impronta: string | null) => TrasportoPost;
}

/** Perché non si può: il testo è già quello da mostrare. null = si può. */
export function perchéNonSiPuò(d: Pick<DipendenzeInserimento, "db" | "acquistato">): string | null {
  if (!d.acquistato()) return "Il modulo Zabbix non è compreso in questa installazione.";
  const cfg = leggiConfigLettura(d.db);
  if (!cfg) return "Manca la configurazione del centro: si fa in Impostazioni → Moduli.";
  if (!chiaveScrittura(d.db)) return "Manca la chiave di scrittura: la emette DA-Link e si inserisce in Impostazioni → Moduli.";
  return null;
}

export async function inserisciHost(
  d: DipendenzeInserimento,
  hostId: number,
  op: OpzioniScrittura = {},
): Promise<EsitoInserimento> {
  const motivo = perchéNonSiPuò(d);
  if (motivo) return { ok: false, status: 409, errore: motivo };
  const oggetto = oggettoDaHost(d.db, hostId);
  if (!oggetto) return { ok: false, status: 404, errore: "Host non trovato" };
  const cfg = leggiConfigLettura(d.db)!;
  const chiave = chiaveScrittura(d.db)!;
  const base = new URL(normalizzaBase(cfg.baseUrl));
  // La famiglia parte dalla classificazione di DA-IPAM (Riccardo, 13/11/2026: «i gruppi con cui
  // classificare inizialmente gli oggetti in zabbix»); da «Apparati» si corregge.
  const famiglia = op.famiglia ?? famigliaDaClassificazione(oggetto.classification ?? null);
  try {
    const esito = await mettiInMonitoraggio({ base, trasportoPost: d.trasportoPost(base, chiave, cfg.impronta) }, oggetto, { ...op, famiglia });
    return { ok: true, esito };
  } catch (e) {
    const testo = e instanceof ErroreLettura ? e.message : "il centro non ha risposto";
    return { ok: false, status: 502, errore: testo.charAt(0).toUpperCase() + testo.slice(1) };
  }
}

type Esito<T> = { ok: true; esito: T } | { ok: false; status: 400 | 404 | 409 | 502; errore: string };

/** Chiama il centro con la chiave di scrittura; i guasti diventano un testo da mostrare. */
async function colCentro<T>(d: DipendenzeInserimento, fai: (l: { base: URL; trasportoPost: TrasportoPost }) => Promise<T>): Promise<Esito<T>> {
  const motivo = perchéNonSiPuò(d);
  if (motivo) return { ok: false, status: 409, errore: motivo };
  const cfg = leggiConfigLettura(d.db)!;
  const chiave = chiaveScrittura(d.db)!;
  const base = new URL(normalizzaBase(cfg.baseUrl));
  try {
    return { ok: true, esito: await fai({ base, trasportoPost: d.trasportoPost(base, chiave, cfg.impronta) }) };
  } catch (e) {
    const testo = e instanceof ErroreLettura ? e.message : "il centro non ha risposto";
    const s = e instanceof ErroreLettura ? e.dettagli.status : undefined;
    const status = s === 400 || s === 404 || s === 409 ? s : 502;
    return { ok: false, status, errore: testo.charAt(0).toUpperCase() + testo.slice(1) };
  }
}

/** Aggiunge e toglie modelli a un apparato di Zabbix (13/11/2026). */
export function cambiaModelliApparato(d: DipendenzeInserimento, c: CambioModelli): Promise<Esito<EsitoModelli>> {
  return colCentro(d, (l) => cambiaModelli(l, c));
}

/** La famiglia di un apparato in Zabbix (tag `famiglia`, 13/11/2026). */
export function cambiaFamigliaApparato(
  d: DipendenzeInserimento,
  c: { hostid: string; famiglia: string; prova?: boolean },
): Promise<Esito<EsitoFamiglia>> {
  return colCentro(d, (l) => cambiaFamiglia(l, c));
}

const CHIAVE_SERVER_ACTIVE = "zabbix.server_active";

/**
 * L'indirizzo a cui l'agente manda i dati, se l'amministratore l'ha già scritto per questo cliente. Serve quando il
 * centro non lo sa: un cliente «diretto», senza proxy (Domarc, 13/11/2026), dove il centro per scelta non indovina.
 */
export function serverActiveSalvato(db: Database.Database): string | null {
  const r = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_SERVER_ACTIVE) as { value: string } | undefined;
  return r?.value && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(r.value) ? r.value : null;
}

export function salvaServerActive(db: Database.Database, ip: string): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(CHIAVE_SERVER_ACTIVE, ip);
}

/** Il comando dell'agente da lanciare a mano sulla macchina (13/11/2026). */
export function comandoAgenteApparato(
  d: DipendenzeInserimento,
  a: { sistema: "windows" | "linux"; hostname?: string | null; serverActive?: string | null },
): Promise<Esito<EsitoAgente>> {
  return colCentro(d, (l) => comandoAgente(l, a));
}
