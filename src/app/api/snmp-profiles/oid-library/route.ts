/**
 * GET: libreria OID esterna (file in config/snmp-oid-library/) — elenco e contenuto common.
 * Aggiungere file in categories/ o devices/ aggiorna l’elenco al ricaricamento.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import {
  getSnmpOidLibraryRevision,
  loadSnmpOidLibraryCommon,
  listSnmpOidLibraryFiles,
} from "@/lib/scanner/snmp-oid-library";

const NO_CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const revision = getSnmpOidLibraryRevision();
    const common = loadSnmpOidLibraryCommon();
    const files = listSnmpOidLibraryFiles();
    return NextResponse.json(
      {
        revision,
        common,
        files,
        root: "config/snmp-oid-library",
      },
      { headers: NO_CACHE }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore lettura libreria OID" },
      { status: 500 }
    );
  }
}
