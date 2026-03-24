import { NextResponse } from "next/server";
import { getCredentialById, getCredentialCommunityString } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

/** Verifica se una credenziale SNMP ha una community string valida */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const cred = getCredentialById(Number(id));
      if (!cred) {
        return NextResponse.json({ valid: false, message: "Credenziale non trovata" }, { status: 404 });
      }
      const type = String(cred.credential_type || "").toLowerCase();
      if (type !== "snmp") {
        return NextResponse.json({
          valid: false,
          message: `La credenziale è di tipo "${cred.credential_type}", non SNMP. Modifica il tipo in Credenziali.`,
        });
      }
      const community = getCredentialCommunityString(Number(id));
      if (!community) {
        return NextResponse.json({
          valid: false,
          message: "Community string mancante o non decifrabile. In Credenziali, modifica la credenziale e inserisci la community string nel campo password.",
        });
      }
      return NextResponse.json({
        valid: true,
        message: "Credenziale SNMP valida",
        hasCommunity: true,
      });
    } catch (error) {
      console.error("Test SNMP credential error:", error);
      return NextResponse.json(
        { valid: false, message: error instanceof Error ? error.message : "Errore nel test" },
        { status: 500 }
      );
    }
  });
}
