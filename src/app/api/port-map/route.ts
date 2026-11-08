/** Mappa porte (piano 2026-11-07): cosa c'è sulla rete e su quale porta. Sola lettura, paginata. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  apparatiDellaMappa, cercaOggetti, cercaPorte, cercaRotte, dettaglioOggetto, DIMENSIONE_PAGINA, ricalcolaMappaPorte, statoCalcolo, vlanDellaMappa,
} from "@/lib/mappa-porte/calcolo";

const numero = z.coerce.number().int().min(0).optional();
const Parametri = z.object({
  vista: z.enum(["oggetti", "porte", "rotte"]).default("oggetti"),
  q: z.string().trim().max(100).optional(),
  apparato: numero,
  vlan: numero,
  confidenza: z.enum(["certa", "spiegata", "da_capire", "non_so"]).optional(),
  tipoPorta: z.enum(["passaggio", "hypervisor", "terminale", "telefono_pc", "condivisa", "wifi", "vuota"]).optional(),
  modo: z.enum(["accesso", "trunk", "non_letto"]).optional(),
  senzaHost: z.literal("1").optional(),
  spostati: z.literal("1").optional(),
  recenti: z.literal("1").optional(),
  libere: z.literal("1").optional(),
  pagina: z.coerce.number().int().min(0).default(0),
  dettaglio: z.string().max(40).optional(),
  // Colonna d'ordinamento: la lista chiusa sta in `calcolo.ts`, una colonna sconosciuta vale l'ordine di sempre.
  sortBy: z.string().regex(/^[a-z]{1,20}$/).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export async function GET(request: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  const voci = Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== ""));
  const p = Parametri.safeParse(voci);
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Parametri non validi" }, { status: 400 });
  const f = p.data;
  return withTenantFromSession(() => {
    if (f.dettaglio) {
      const d = dettaglioOggetto(f.dettaglio);
      return d ? NextResponse.json(d) : NextResponse.json({ error: "Oggetto non trovato" }, { status: 404 });
    }
    // Primo accesso dopo l'aggiornamento: non si aspetta il giro.
    if (statoCalcolo() == null) ricalcolaMappaPorte();
    const ordine = { colonna: f.sortBy, verso: f.sortDir };
    const elenco = f.vista === "rotte"
      ? cercaRotte({ q: f.q, deviceId: f.apparato, pagina: f.pagina, ordine })
      : f.vista === "porte"
      ? cercaPorte({ q: f.q, deviceId: f.apparato, tipo: f.tipoPorta, modo: f.modo, libere: f.libere === "1", pagina: f.pagina, ordine })
      : cercaOggetti({ q: f.q, deviceId: f.apparato, vlan: f.vlan, confidenza: f.confidenza, tipoPorta: f.tipoPorta, senzaHost: f.senzaHost === "1", spostati: f.spostati === "1", recenti: f.recenti === "1", pagina: f.pagina, ordine });
    return NextResponse.json({ ...elenco, dimensionePagina: DIMENSIONE_PAGINA, calcolo: statoCalcolo(), apparati: apparatiDellaMappa(), vlan: vlanDellaMappa() });
  });
}
