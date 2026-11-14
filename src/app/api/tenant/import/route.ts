// src/app/api/tenant/import/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getHubDb } from "@/lib/db-hub";
import { importTenant } from "@/lib/transfer/import";
import { confermaValida, utenteDaSessione } from "@/lib/vault/mostra";
import { isTecnico } from "@/lib/profilo";
import { puoScaricareHub } from "@/lib/accesso/profilo-pubblico";

export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart/form-data atteso" }, { status: 400 }); }

    const file = form.get("bundle");
    const passphrase = form.get("passphrase");
    const wipe = form.get("wipe") === "true";
    if (!(file instanceof File)) return NextResponse.json({ error: "Campo 'bundle' mancante" }, { status: 400 });
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      return NextResponse.json({ error: "Passphrase non valida" }, { status: 400 });
    }

    // Lo svuotamento cancella tutti i dati del cliente: serve la conferma recente in due passaggi (Riccardo, 14/11).
    if (wipe && confermaValida(utenteDaSessione(auth).id) === null) {
      return NextResponse.json(
        { error: "Per svuotare e importare serve la conferma con la verifica in due passaggi." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });

    const bundle = Buffer.from(await file.arrayBuffer());
    try {
      const res = importTenant({
        bundle, tenantDb: getTenantDb(tenantCode), hubDb: getHubDb(),
        // Sul profilo tecnico le risorse comuni a tutti i clienti le tocca solo il superadmin (P0-1, 14/11).
        options: { tenantCode, passphrase, wipe, risorseGlobali: puoScaricareHub(auth.user.role, isTecnico()) },
      });
      console.info(`[import] ${tenantCode}: pacchetto importato da ${auth.user.name ?? "?"} (${wipe ? "con svuotamento" : "unione"})`);
      return NextResponse.json({ ok: true, result: res });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
