/**
 * La logica delle rotte di Schedulazioni, fuori dalle rotte per provarla senza sessione: `GET /api/schedulazioni` elenca,
 * `PUT /api/schedulazioni/[id]` accende o spegne. Le righe che hanno una riga in Opzioni passano da `cambiaOpzione` (stessa
 * lapide, stesso registro); gli altri job dal loro interruttore, come la pagina dei job; Edge e timer non si cambiano da qui.
 */
import { z } from "zod";
import { toggleJob } from "@/lib/db-tenant";
import { cambiaOpzione, eAdmin, type Chiamante, type EsitoRotta } from "@/lib/opzioni/cambio";
import { elencoSchedulazioni, trovaRiga, type RigaSchedulazione } from "./elenco";

export async function elenco(ruolo: unknown): Promise<{ puoCambiare: boolean; righe: RigaSchedulazione[] }> {
  return { puoCambiare: eAdmin(ruolo), righe: await elencoSchedulazioni() };
}

const Corpo = z.object({ acceso: z.boolean({ error: "acceso: vero o falso" }) }, { error: "Richiesta non valida" }).strict();

export async function cambiaSchedulazione(id: string, corpo: unknown, c: Chiamante, ricarica: () => string | null): Promise<EsitoRotta> {
  if (!eAdmin(c.ruolo)) return { status: 403, body: { error: "Solo un amministratore può accendere o spegnere le schedulazioni" } };
  const p = Corpo.safeParse(corpo);
  if (!p.success) return { status: 400, body: { error: p.error.issues[0]?.message ?? "Richiesta non valida" } };
  const riga = await trovaRiga(id);
  if (!riga) return { status: 404, body: { error: "Schedulazione sconosciuta" } };
  if (!riga.cambio) return { status: 409, body: { error: riga.perche ?? "Da qui non si cambia", dove: riga.dove?.href ?? null } };
  if (riga.cambio.tipo === "opzione") return cambiaOpzione(riga.cambio.id, { acceso: p.data.acceso }, c, ricarica);

  const prima = riga.stato;
  toggleJob(riga.cambio.id, p.data.acceso);
  const avviso = ricarica();
  // Registro: chi (id, non nome), quale job, prima → dopo. Stesso canale di Opzioni.
  console.info(`[schedulazioni] audit ${JSON.stringify({ utente: c.idUtente, riga: riga.id, prima, dopo: p.data.acceso ? "acceso" : "spento" })}`);
  return { status: 200, body: { ...(avviso ? { avviso } : {}) } };
}
