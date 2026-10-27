/**
 * La logica delle rotte di Opzioni (spec §3.3), fuori dalle rotte per provarla senza sessione: `GET /api/opzioni` elenca,
 * `PUT /api/opzioni/[id]` cambia. Le rotte mettono l'autenticazione e il contesto del cliente; qui le regole.
 */
import { z } from "zod";
import { catalogo, leggiStato, leggiTutte } from "./catalogo";
import { ErroreOpzione, type Opzione, type StatoOpzione, type VoceOpzione } from "./tipi";

export const eAdmin = (ruolo: unknown): boolean => ruolo === "admin" || ruolo === "superadmin";

/**
 * Le opzioni dell'hub valgono per tutti i clienti: le cambia chi può scrivere le impostazioni dell'hub, con la stessa
 * regola di `PUT /api/settings` (`requireAdminOrOnboarding`: admin o superadmin; a onboarding chiuso nessun altro).
 */
export const puoCambiareHub = (ruolo: unknown): boolean => eAdmin(ruolo);

export function voce(o: Opzione, stato: StatoOpzione): VoceOpzione {
  return {
    id: o.id, gruppo: o.gruppo, nome: o.nome, cosa: o.cosa, valePer: o.valePer, forma: o.forma, diSerie: o.diSerie,
    ...(o.scelte ? { scelte: o.scelte } : {}),
    ...(o.configura ? { configura: o.configura } : {}),
    ...(o.parametro ? { parametro: o.parametro } : {}),
    ...(o.spegnendo ? { spegnendo: o.spegnendo } : {}),
    ...(o.accendendo ? { accendendo: o.accendendo } : {}),
    ...(o.dove ? { dove: o.dove } : {}),
    cambiabile: o.forma !== "file" && o.forma !== "fisso" && typeof o.cambia === "function",
    stato,
  };
}

export async function elencoOpzioni(ruolo: unknown, opzioni?: Opzione[]): Promise<{ puoCambiare: boolean; opzioni: VoceOpzione[] }> {
  const righe = await leggiTutte(opzioni);
  return { puoCambiare: eAdmin(ruolo), opzioni: righe.map((r) => voce(r.opzione, r.stato)) };
}

const Corpo = z
  .object(
    {
      acceso: z.boolean({ error: "acceso: vero o falso" }).optional(),
      // 2000: l'elenco delle porte TCP della scansione veloce sta in un valore solo.
      valore: z.string({ error: "valore: un testo" }).max(2000, "valore troppo lungo").optional(),
      diSerie: z.literal(true, { error: "diSerie: solo vero" }).optional(),
    },
    { error: "Richiesta non valida" },
  )
  .strict()
  .refine((c) => c.acceso !== undefined || c.valore !== undefined || c.diSerie !== undefined, {
    error: "Indica se accendere, spegnere o il valore",
  });

export interface Chiamante {
  ruolo: unknown;
  /** Il nome che resta sulla riga («spenta da … il …»). */
  chi: string;
  /** Per il registro: l'id dell'utente, non il nome. */
  idUtente: string | null;
}

export interface EsitoRotta {
  status: number;
  body: Record<string, unknown>;
}

function codice(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  return e instanceof Error ? e.name : "errore";
}

const sintesi = (s: StatoOpzione): string => (s.valore !== undefined ? `${s.acceso}/${s.valore}` : String(s.acceso));

/**
 * Cambia un'opzione. `ricarica` rilegge i job del cliente nello scheduler (solo per le opzioni che toccano i job) e
 * restituisce un avviso se non ci riesce. Un cambio rifiutato o fallito non scrive il registro.
 */
export async function cambiaOpzione(
  id: string,
  corpo: unknown,
  c: Chiamante,
  ricarica: () => string | null,
  opzioni: Opzione[] = catalogo(),
): Promise<EsitoRotta> {
  if (!eAdmin(c.ruolo)) return { status: 403, body: { error: "Solo un amministratore può cambiare le opzioni" } };
  const p = Corpo.safeParse(corpo);
  if (!p.success) return { status: 400, body: { error: p.error.issues[0]?.message ?? "Richiesta non valida" } };
  const o = opzioni.find((x) => x.id === id);
  if (!o) return { status: 404, body: { error: "Opzione sconosciuta" } };
  if (o.forma === "file" || o.forma === "fisso") {
    const prima = o.forma === "fisso" ? "Da qui non si cambia." : "Si cambia solo sul server.";
    return { status: 405, body: { error: `${prima} ${o.dove ?? ""}`.trim() } };
  }
  if (!o.cambia) {
    return { status: 409, body: { error: "Da qui non si cambia: si accende configurandola nella sua scheda", configura: o.configura?.href ?? null } };
  }
  if (o.valePer === "hub" && !puoCambiareHub(c.ruolo)) {
    return { status: 403, body: { error: "Questa opzione vale per tutti i clienti: la cambia solo un amministratore dell'appliance" } };
  }

  const prima = await leggiStato(o);
  try {
    await o.cambia(p.data, c.chi);
  } catch (e) {
    if (e instanceof ErroreOpzione) return { status: e.status, body: { error: e.message } };
    console.error(`[opzioni] cambio di ${o.id} non riuscito:`, codice(e));
    return { status: 500, body: { error: `Cambio non riuscito (${codice(e)})` } };
  }
  const avviso = o.tocchiJob ? ricarica() : null;
  const dopo = await leggiStato(o);
  // Registro: chi (id, non nome), quale opzione, prima → dopo. Canale diagnostico, come le altre rotte.
  console.info(`[opzioni] audit ${JSON.stringify({ utente: c.idUtente, opzione: o.id, prima: sintesi(prima), dopo: sintesi(dopo) })}`);
  return { status: 200, body: { stato: dopo, ...(o.scelte ? { scelte: o.scelte } : {}), ...(avviso ? { avviso } : {}) } };
}
