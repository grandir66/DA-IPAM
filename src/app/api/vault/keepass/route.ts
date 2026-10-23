import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";
import { esportaKeePass, esportaKeyFile } from "@/lib/vault/keepass";
import { utenteDaSessione } from "@/lib/vault/mostra";

const Corpo = z.object({ passphrase: z.string().min(1).max(1024), parte: z.enum(["kdbx", "keyfile"]) });

/**
 * «Esporta in KeePass»: il file KDBX (passphrase del cliente + key file) oppure il key file. Vuole la passphrase del
 * cliente; ogni esportazione va nel registro.
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Servono la passphrase e la parte (kdbx o keyfile)" }, { status: 400 });
    const utente = utenteDaSessione(s);
    const giorno = new Date().toISOString().slice(0, 10);
    if (parsed.data.parte === "keyfile") {
      const k = await esportaKeyFile({ dbh: getDb(), utente, passphrase: parsed.data.passphrase });
      if (!k.ok) return NextResponse.json({ error: k.errore }, { status: k.stato });
      return new NextResponse(Buffer.from(k.keyfile), {
        headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="da-ipam-${giorno}.keyx"`, "Cache-Control": "no-store" },
      });
    }
    const e = await esportaKeePass({ dbh: getDb(), utente, passphrase: parsed.data.passphrase });
    if (!e.ok) return NextResponse.json({ error: e.errore }, { status: e.stato });
    return new NextResponse(Buffer.from(e.kdbx), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="da-ipam-${giorno}.kdbx"`,
        "Cache-Control": "no-store",
        "X-Voci-Esportate": String(e.voci),
        "X-Voci-Saltate": String(e.saltate.length),
      },
    });
  });
}
