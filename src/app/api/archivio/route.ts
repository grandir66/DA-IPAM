import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { indirizzoDaIntestazioni } from "@/lib/accesso/registro-accessi";
import { getUserById } from "@/lib/db-hub";
import { copiaConFrase, difettoFrase, statoCopie } from "@/lib/archivio-utenti/copia";
import { leggiRegistroArchivio, scriviRegistroArchivio } from "@/lib/archivio-utenti/deposito";
import { IMPORTA_MAX_BYTE, importaKdbx } from "@/lib/archivio-utenti/importa";
import { apriArchivio, chiHaAccesso, chiudiArchivio, creaArchivio, daiAccesso, sostituisciChiaveRecupero, sostituisciCodiceAmministratore, statoArchivio, togliAccesso, type Dipendenze, type Esito, type Persona } from "@/lib/archivio-utenti/motore";
import { haSecondoFattore, verificaCodiceUtente } from "@/lib/archivio-utenti/secondo-fattore";
import { MASSIMO_MS, SENZA_GESTI_MS, chiaveAperta } from "@/lib/archivio-utenti/sessioni";
import { cancellaVoce, dettaglioVoce, elencoVoci, leggiCampo, ripristinaVersione, scriviVoce, spostaVoce, storicoVoce } from "@/lib/archivio-utenti/voci";

export const dynamic = "force-dynamic";

/**
 * L'archivio degli utenti (ADR 0043). Basta essere collegati: qui il ruolo nell'installazione non dà nessun potere.
 * Decide il motore: per aprire serve la propria serratura (password principale personale e codice a sei cifre), per
 * dare o togliere un accesso serve il codice dell'amministratore dell'archivio.
 */
function persona(s: { user: { id?: string | null; name?: string | null; role?: string } }): Persona | null {
  const id = Number(s.user.id);
  return Number.isInteger(id) && id > 0 ? { id, nome: s.user.name ?? "sconosciuto", ruolo: s.user.role ?? "viewer" } : null;
}

const testo = (max: number) => z.string().max(max);
const schema = z.discriminatedUnion("azione", [
  z.object({ azione: z.literal("crea"), codice: testo(12) }),
  z.object({ azione: z.literal("apri"), password: testo(256), codice: testo(12), nuovaPassword: testo(256).optional() }),
  z.object({ azione: z.literal("chiudi") }),
  z.object({ azione: z.literal("dai_accesso"), codiceAmministratore: testo(80), utenteId: z.number().int().positive(), passwordProvvisoria: testo(256) }),
  z.object({ azione: z.literal("togli_accesso"), codiceAmministratore: testo(80), utenteId: z.number().int().positive() }),
  z.object({ azione: z.literal("sostituisci_codice"), codiceAmministratore: testo(80) }),
  z.object({ azione: z.literal("dettaglio"), percorso: testo(300) }),
  z.object({ azione: z.literal("campo"), percorso: testo(300), campo: testo(64), modo: z.enum(["mostrato", "copiato"]) }),
  z.object({
    azione: z.literal("scrivi"), percorso: testo(300).optional(), gruppo: testo(200), titolo: testo(120), utente: testo(200).optional(), url: testo(500).optional(),
    note: testo(4000).optional(), segreti: z.record(testo(64), testo(2000)).optional(), versioneAttesa: z.number().int().nonnegative().optional(),
  }),
  z.object({ azione: z.literal("cancella"), percorso: testo(300), versioneAttesa: z.number().int().nonnegative().optional() }),
  z.object({ azione: z.literal("sposta"), percorso: testo(300), gruppo: testo(200), versioneAttesa: z.number().int().nonnegative().optional() }),
  z.object({ azione: z.literal("storico"), percorso: testo(300) }),
  z.object({ azione: z.literal("ripristina"), percorso: testo(300), indietro: z.number().int().min(1).max(10), versioneAttesa: z.number().int().nonnegative().optional() }),
  z.object({ azione: z.literal("registro") }),
  z.object({ azione: z.literal("sostituisci_chiave_recupero"), codiceAmministratore: testo(80) }),
  z.object({ azione: z.literal("scarica"), frase: testo(256), codice: testo(12) }),
  // Il file arriva in base64: 5 MB di file sono circa 7 milioni di caratteri.
  z.object({ azione: z.literal("importa"), file: z.string().max(Math.ceil(IMPORTA_MAX_BYTE * 1.4)), password: testo(256) }),
]);

const rispondi = (e: Esito<object>) => (e.ok ? NextResponse.json(e) : NextResponse.json({ error: e.errore }, { status: e.stato }));

/** Lo stato per chi guarda; ad archivio aperto anche le voci (senza segreti) e chi ha l'accesso. */
export async function GET() {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  const chi = persona(sessione);
  if (!chi) return NextResponse.json({ error: "L'utenza di servizio non usa l'archivio: entra col tuo utente" }, { status: 403 });
  try {
    const stato = statoArchivio(chi.id);
    const base = { stato, secondoFattore: haSecondoFattore(chi.id), puoCreare: chi.ruolo === "admin" || chi.ruolo === "superadmin", senzaGestiMs: SENZA_GESTI_MS, massimoMs: MASSIMO_MS, io: chi.id };
    if (!stato.aperto) return NextResponse.json(base);
    const voci = await elencoVoci(chi);
    return NextResponse.json({ ...base, voci: voci.ok ? voci.voci : [], accessi: chiHaAccesso(), copie: statoCopie() });
  } catch (e) {
    console.error("[archivio] stato:", e instanceof Error ? e.name : "errore");
    return NextResponse.json({ error: "Stato dell'archivio non letto" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const sessione = await requireAuth();
  if (isAuthError(sessione)) return sessione;
  const chi = persona(sessione);
  if (!chi) return NextResponse.json({ error: "L'utenza di servizio non usa l'archivio: entra col tuo utente" }, { status: 403 });
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const letto = schema.safeParse(corpo);
  if (!letto.success) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const d = letto.data;
  const indirizzo = indirizzoDaIntestazioni(request.headers);
  const dip: Dipendenze = { verificaCodice: verificaCodiceUtente, indirizzo };
  try {
    switch (d.azione) {
      case "crea": return rispondi(await creaArchivio({ chi, codice: d.codice }, dip));
      case "apri": return rispondi(await apriArchivio({ chi, password: d.password, codice: d.codice, nuovaPassword: d.nuovaPassword }, dip));
      case "chiudi": chiudiArchivio(chi, dip); return NextResponse.json({ ok: true });
      case "dai_accesso":
      case "togli_accesso": {
        const u = getUserById(d.utenteId);
        if (!u) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
        const a = { id: u.id, nome: u.username };
        return rispondi(d.azione === "dai_accesso" ? await daiAccesso({ chi, codiceAmministratore: d.codiceAmministratore, a, passwordProvvisoria: d.passwordProvvisoria }, dip) : await togliAccesso({ chi, codiceAmministratore: d.codiceAmministratore, a }, dip));
      }
      case "sostituisci_codice": return rispondi(await sostituisciCodiceAmministratore({ chi, codiceAmministratore: d.codiceAmministratore }, dip));
      case "dettaglio": return rispondi(await dettaglioVoce(chi, d.percorso));
      case "campo": return rispondi(await leggiCampo(chi, { percorso: d.percorso, campo: d.campo, modo: d.modo, indirizzo }));
      case "scrivi": return rispondi(await scriviVoce(chi, d, { indirizzo }));
      case "cancella": return rispondi(await cancellaVoce(chi, d.percorso, { versioneAttesa: d.versioneAttesa, indirizzo }));
      case "sposta": return rispondi(await spostaVoce(chi, d, { indirizzo }));
      case "storico": return rispondi(await storicoVoce(chi, d.percorso));
      case "ripristina": return rispondi(await ripristinaVersione(chi, d, { indirizzo }));
      case "sostituisci_chiave_recupero": return rispondi(await sostituisciChiaveRecupero({ chi, codiceAmministratore: d.codiceAmministratore }, dip));
      case "registro": {
        // Il registro lo legge chi ha l'archivio aperto: dentro ci sono i nomi delle voci.
        if (!chiaveAperta(chi.id)) return NextResponse.json({ error: "L'archivio è chiuso" }, { status: 423 });
        return NextResponse.json({ ok: true, righe: leggiRegistroArchivio() });
      }
      case "scarica": {
        const aperta = chiaveAperta(chi.id);
        if (!aperta) return NextResponse.json({ error: "L'archivio è chiuso" }, { status: 423 });
        const difetto = difettoFrase(d.frase);
        if (difetto) return NextResponse.json({ error: difetto }, { status: 400 });
        // Portare fuori tutto l'archivio vuole di nuovo il codice a sei cifre, anche a sessione aperta.
        if (!verificaCodiceUtente(chi.id, d.codice, Date.now())) return NextResponse.json({ error: "Codice a 6 cifre non valido" }, { status: 403 });
        const file = await copiaConFrase(aperta.chiave, d.frase);
        scriviRegistroArchivio({ azione: "copia_scaricata", utente: chi.nome, utenteId: chi.id, da: indirizzo });
        return NextResponse.json({ ok: true, nome: `archivio-${new Date().toISOString().slice(0, 10)}.kdbx`, file: Buffer.from(file).toString("base64") });
      }
      case "importa": {
        let dati: Buffer;
        try {
          dati = Buffer.from(d.file, "base64");
        } catch {
          return NextResponse.json({ error: "File non valido" }, { status: 400 });
        }
        return rispondi(await importaKdbx(chi, { dati: new Uint8Array(dati), password: d.password, indirizzo }));
      }
    }
  } catch (e) {
    // Mai il messaggio dell'eccezione: potrebbe portare un valore.
    console.error("[archivio] azione non riuscita:", d.azione, e instanceof Error ? e.name : "errore");
    return NextResponse.json({ error: "Operazione non riuscita" }, { status: 500 });
  }
}
