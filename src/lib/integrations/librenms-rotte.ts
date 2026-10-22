/**
 * I corpi delle rotte di LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 5), senza sessione: le rotte
 * mettono guardia (`requireAuth`/`requireAdmin`) e contesto del tenant, qui c'è il resto, provato da
 * `__tests__/librenms-rotte.test.ts`. La guardia la provano `rotte-censite` e `scripts/verifica-permessi.sh`.
 */
import { z } from "zod";
import { letturaAccesa } from "../topology/letture/interruttori";
import { getHostById } from "../db-tenant";
import { candidatiLibrenms, datiLibrenmsHost, lettureLibrenms, ultimoGiroLibrenms } from "./librenms-fonte";
import { addSingleHostToLibreNMS, type EsitoAggiunta } from "./librenms-sync";

export interface Risposta { status: number; corpo: unknown }

/**
 * GET /api/hosts/[id]/librenms/dati: i dati di LibreNMS dell'host, o `{ abbinato: false }`, con `acceso` = l'interruttore
 * della lettura `librenms` (spento: la scheda ignora i dati e resta com'era; le righe nelle tabelle possono essere vecchie).
 */
export function rispostaDatiHost(idTesto: string): Risposta {
  const id = Number(idTesto);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, corpo: { error: "Id dell'host non valido" } };
  if (!getHostById(id)) return { status: 404, corpo: { error: "Host non trovato" } };
  return { status: 200, corpo: { ...datiLibrenmsHost(id), acceso: letturaAccesa("librenms") } };
}

/** GET /api/integrations/librenms/candidati: le tre liste, lo stato della lettura per parte e l'esito dell'ultimo giro. */
export function rispostaCandidati(): Risposta {
  return { status: 200, corpo: { ...candidatiLibrenms(), letture: lettureLibrenms(), ultimo_giro: ultimoGiroLibrenms() } };
}

const CorpoAggiunta = z.object({ host_id: z.number().int().positive() }, { error: "Richiesta non valida" }).strict();

/**
 * POST /api/integrations/librenms/candidati `{ host_id }`: l'aggiunta di un candidato, con la stessa prova SNMP del task 1
 * (mai `force_add`). Un rifiuto di LibreNMS è 422 col motivo e il codice.
 */
export async function rispostaAggiungiCandidato(corpo: unknown, aggiungi: (hostId: number) => Promise<EsitoAggiunta> = addSingleHostToLibreNMS): Promise<Risposta> {
  const p = CorpoAggiunta.safeParse(corpo);
  if (!p.success) return { status: 400, corpo: { error: p.error.issues[0]?.message ?? "Richiesta non valida" } };
  if (!getHostById(p.data.host_id)) return { status: 404, corpo: { error: "Host non trovato" } };
  let e: EsitoAggiunta;
  try {
    e = await aggiungi(p.data.host_id);
  } catch (err) {
    return { status: 422, corpo: { error: err instanceof Error ? err.message : "Aggiunta non riuscita" } };
  }
  if (!e.ok) {
    const testo = e.codice === "rete" ? e.messaggio : `LibreNMS ha rifiutato l'aggiunta: ${e.messaggio}`;
    return { status: 422, corpo: { error: testo, codice: e.codice } };
  }
  return { status: 200, corpo: { librenms_device_id: e.librenms_device_id, added: e.aggiunto } };
}
