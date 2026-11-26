import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { anteprimaPolitica } from "@/lib/protezione/anteprima";
import { SECONDI_PROVA, annulla, conferma, osserva, politicaInVigore, prova, provaAVuoto, spegni, statoFiltro, vistiFuori, type EsitoAzione } from "@/lib/protezione/esecutore";
import { erroriPolitica, type Politica } from "@/lib/protezione/politica";
import { scriviRegistroProtezione, type RigaRegistroProtezione } from "@/lib/protezione/registro-protezione";

export const dynamic = "force-dynamic";

/**
 * L'indirizzo di chi chiama, come lo passa nginx. Vale perché le porte interne sono chiuse (3001 non si raggiunge
 * da fuori); serve solo ad avvisare chi sta per chiudersi fuori, non a decidere un permesso.
 */
function chiamante(request: Request): string | null {
  const v = (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().replace(/^::ffff:/, "");
  return v || null;
}

const voce = z.object({ aperto: z.boolean(), indirizzi: z.array(z.string().max(64)).max(256) });
const schemaPolitica = z.object({
  sempre: z.array(z.string().max(64)).max(256),
  gruppi: z.object({ web: voce, ssh: voce, console: voce, dati: voce }),
});
const schema = z.discriminatedUnion("azione", [
  z.object({ azione: z.enum(["anteprima", "osserva", "prova"]), politica: schemaPolitica }),
  z.object({ azione: z.enum(["conferma", "annulla", "spegni"]) }),
]);

/** Stato del filtro, politica in vigore, chi è stato visto restare fuori, e l'indirizzo di chi guarda. */
export async function GET(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  try {
    const [stato, visti] = await Promise.all([statoFiltro(), vistiFuori()]);
    return NextResponse.json({ stato, politica: politicaInVigore(), visti, tuoIndirizzo: chiamante(request), secondiProva: SECONDI_PROVA });
  } catch (e) {
    console.error("[protezione] stato del filtro:", e);
    return NextResponse.json({ error: "Stato del filtro non letto" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const sessione = await requireAdmin();
  if (isAuthError(sessione)) return sessione;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const letto = schema.safeParse(corpo);
  if (!letto.success) return NextResponse.json({ error: "Richiesta non valida", dettagli: letto.error.issues.map((i) => i.message) }, { status: 400 });
  const dati = letto.data;
  const da = chiamante(request);
  const utente = (sessione.user as { name?: string | null }).name ?? "sconosciuto";

  try {
    if (dati.azione === "anteprima" || dati.azione === "osserva" || dati.azione === "prova") {
      const politica: Politica = dati.politica;
      const errori = erroriPolitica(politica);
      if (errori.length > 0) return NextResponse.json({ error: errori.join("; ") }, { status: 400 });
      if (dati.azione === "anteprima") {
        const [vuoto, visti] = await Promise.all([provaAVuoto(politica), vistiFuori()]);
        return NextResponse.json({ anteprima: anteprimaPolitica(politicaInVigore(), politica, visti, da), regole: vuoto });
      }
    }
    const stato = await statoFiltro();
    if (!stato.disponibile) return NextResponse.json({ error: stato.motivo }, { status: 409 });

    let esito: EsitoAzione;
    if (dati.azione === "osserva") esito = await osserva(dati.politica);
    else if (dati.azione === "prova") esito = await prova(dati.politica);
    else if (dati.azione === "conferma") esito = await conferma();
    else if (dati.azione === "annulla") esito = await annulla();
    else esito = await spegni();

    const riga: RigaRegistroProtezione = { azione: dati.azione as RigaRegistroProtezione["azione"], utente, da, esito: esito.ok ? "riuscita" : "fallita", dettaglio: esito.messaggio };
    if (esito.prima !== esito.dopo) { riga.prima = esito.prima; riga.dopo = esito.dopo; }
    scriviRegistroProtezione(riga);
    return NextResponse.json({ ok: esito.ok, messaggio: esito.messaggio, stato: await statoFiltro() }, { status: esito.ok ? 200 : 409 });
  } catch (e) {
    console.error("[protezione] azione sul filtro:", e);
    return NextResponse.json({ error: "Azione non riuscita: guarda il registro di sistema" }, { status: 500 });
  }
}
