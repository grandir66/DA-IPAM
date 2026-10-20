import { z } from "zod";
import { verificaAccessoLocale } from "@/lib/accesso/accesso-locale";

/**
 * Passo 1 della pagina d'accesso (Riccardo, 20/10; ADR 0023): nome e password giusti →
 * si entra subito, oppure serve il codice, oppure (2FA richiesta e non ancora attivata) il QR
 * da inquadrare. Sotto `/api/auth/*` → nessuna sessione richiesta (regola API routes).
 *
 * Non dice mai se il nome esiste: ogni rifiuto è «rifiuta». Conta i fallimenti nello stesso
 * blocco del login e non lo azzera (l'azzeramento lo fa solo l'accesso completo): chi conosce
 * la password non può usare questa rotta per provare codici senza limite. Risposte mai in cache.
 */
const Corpo = z.object({
  username: z.string().max(128),
  password: z.string().max(1024),
});

export async function POST(req: Request): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ esito: "rifiuta" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const dati = Corpo.safeParse(corpo);
  if (!dati.success) return Response.json({ esito: "rifiuta" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const e = await verificaAccessoLocale(dati.data, { fase: "passo_uno" });
  const intestazioni = { "Cache-Control": "no-store" };
  switch (e.esito) {
    case "entra":
    case "servizio":
      return Response.json({ esito: "entra" }, { headers: intestazioni });
    case "serve_codice":
      return Response.json({ esito: "serve_codice" }, { headers: intestazioni });
    case "serve_attivazione":
      return Response.json({ esito: "serve_attivazione", segreto: e.segreto, qr: e.qr }, { headers: intestazioni });
    case "bloccato":
      return Response.json({ esito: "bloccato", secondi: e.secondi }, { status: 429, headers: intestazioni });
    default:
      return Response.json({ esito: "rifiuta" }, { status: 401, headers: intestazioni });
  }
}
