/**
 * Un giro di lettura dei client collegati di UN controller UniFi (topologia
 * fase 2, spec §10.5): `stat/sta` in sola lettura → righe della tabella dei MAC
 * per porta con source "unifi" (cablato sulla porta dello switch, wireless
 * sulla porta "wifi" dell'AP).
 *
 * - Il client del controller si costruisce come per la lettura degli apparati
 *   (`controllerClientOf`: segreto decifrato con `safeDecrypt`, impronta della
 *   riga, lista bianca delle richieste di `unifi-api.ts`).
 * - Un errore del controller (rete, credenziali, certificato, risposta d'errore)
 *   esce PRIMA di qualunque scrittura: è «non so», non «zero client». Le righe
 *   esistenti restano e invecchiano (pulizia a 30 giorni).
 * - Il giro finisce nello storico del controller con trigger «client:manual» o
 *   «client:schedule» (lo storico non ha un campo per il tipo: la potatura,
 *   50 per tipo, e le letture lo distinguono dal prefisso) e `message` che
 *   comincia per «Lettura client:»; i conteggi della riga del controller
 *   restano quelli degli apparati.
 * - Nessun log con MAC, nomi o IP dei client (l'unico avviso è uno storico non
 *   registrato, col messaggio del DB).
 *
 * Va chiamato nel contesto del tenant. `db-tenant` importato staticamente (ADR 0002).
 */
import {
  getControllerDevicePortNames,
  getNetworkController,
  recordControllerRun,
  runInTenantTransaction,
  upsertMacPortEntries,
} from "@/lib/db-tenant";
import { controllerClientOf, migrateLegacyUnifiConfig } from "@/lib/controllers/service";
import type { ControllerRunTrigger } from "@/lib/controllers/types";
import type { UnifiClientOptions } from "./unifi-api";
import { mapClientsToPorts, type UnifiStaClient } from "./unifi-clients";

/** Chi fornisce i client collegati: il client del controller, o un finto nelle prove. */
export interface UnifiClientSource {
  listClients(): Promise<UnifiStaClient[]>;
}

export interface UnifiClientsSyncResult {
  ok: boolean;
  /** Client restituiti dal controller. */
  clients: number;
  /** Righe scritte nella tabella dei MAC per porta. */
  saved: number;
  /** Client dietro uno switch o un AP che il tenant non conosce (o senza porta). */
  unmatched: number;
  /** Perché il giro è fallito; null se è andato. */
  failure: string | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nowSql(): string {
  // Stesso formato di datetime('now') di SQLite: UTC senza fuso (parseDbDate lo legge).
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function readAndSave(source: UnifiClientSource): Promise<UnifiClientsSyncResult> {
  let clients: UnifiStaClient[];
  try {
    clients = await source.listClients();
  } catch (e) {
    return { ok: false, clients: 0, saved: 0, unmatched: 0, failure: errorMessage(e) };
  }
  const { devices, ports } = getControllerDevicePortNames();
  const portNames = new Map(ports.map((p) => [`${p.device_id}|${p.port_index}`, p.port_name] as const));
  const { byDevice, unmatched } = mapClientsToPorts(clients, devices, portNames);
  try {
    // Tutto il giro o niente: un errore a metà non lascia metà dei client nuovi.
    const saved = runInTenantTransaction(() => {
      let n = 0;
      for (const [deviceId, list] of byDevice) {
        upsertMacPortEntries(
          deviceId,
          list.map((r) => ({ mac: r.mac, port_name: r.port_name, vlan: null, port_status: null, speed: null })),
          "unifi",
        );
        n += list.length;
      }
      return n;
    });
    return { ok: true, clients: clients.length, saved, unmatched, failure: null };
  } catch (e) {
    return { ok: false, clients: clients.length, saved: 0, unmatched, failure: `Scrittura non riuscita: ${errorMessage(e)}` };
  }
}

/**
 * Legge i client collegati del controller `controllerId` e li scrive nella
 * tabella dei MAC per porta. Non lancia. `opts.clientOptions` e `opts.source`
 * servono alle prove, `opts.triggeredBy` a chi lancia a mano.
 */
export async function syncUnifiClientsForController(
  controllerId: number,
  trigger: ControllerRunTrigger,
  opts: { triggeredBy?: string | null; clientOptions?: UnifiClientOptions; source?: UnifiClientSource } = {},
): Promise<UnifiClientsSyncResult> {
  migrateLegacyUnifiConfig();
  const startedAt = nowSql();
  const fail = (msg: string): UnifiClientsSyncResult => ({ ok: false, clients: 0, saved: 0, unmatched: 0, failure: msg });
  const row = getNetworkController(controllerId);
  if (!row) return fail("Controller non trovato");

  let result: UnifiClientsSyncResult;
  if (row.enabled !== 1) result = fail("Controller spento: nessuna lettura");
  else if (row.kind === "omada") result = fail("Omada non è ancora disponibile: nessuna lettura");
  else result = await readAndSave(opts.source ?? controllerClientOf(row, opts.clientOptions));

  const message =
    "Lettura client: " +
    (result.failure ?? `${result.clients} letti, ${result.saved} salvati, ${result.unmatched} non abbinati`);
  try {
    recordControllerRun(
      {
        controller_id: controllerId,
        started_at: startedAt,
        finished_at: nowSql(),
        trigger: `client:${trigger}`,
        triggered_by: opts.triggeredBy ?? null,
        ok: result.ok ? 1 : 0,
        total: result.clients,
        added: 0,
        updated: 0,
        skipped: result.unmatched,
        ports: result.saved,
        neighbors: 0,
        message,
        errors_json: JSON.stringify(result.failure ? [result.failure] : []),
        skipped_reasons_json: "[]",
        offline_json: "[]",
      },
      { summary: false },
    );
  } catch (e) {
    // Lo storico non fa fallire una lettura già scritta (come `syncController`),
    // ma non si tace: il messaggio è quello del DB, senza dati dei client.
    console.warn(`[unifi-clients] storico della lettura non registrato (controller ${controllerId}): ${errorMessage(e)}`);
  }
  return result;
}
