import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getAllHostsEnriched,
  getAllHostValidatedProtocols,
  getAllMultihomedLinks,
  getClusterDiscovery,
  getAllHostsVulnSummary,
  schemaAssegnatariAdPresente,
} from "@/lib/db-tenant";
import { dbCliente } from "@/lib/assegnatari/db";
import { utentiAbituali, type UtenteAbituale } from "@/lib/assegnatari/abituale";

export async function GET(req: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    try {
      // v0.2.647 audit perf UI1: modalità "lite" esclude i blob JSON che la
      // tabella discovery non rende (snmp_data, conflict_flags). Riduce il
      // payload tipicamente del 30-50% e taglia il JSON.parse client. Il client
      // chiede ?lite=1; senza param resta full per back-compat (objects/[id],
      // export, integrazioni esterne).
      const url = new URL(req.url);
      const lite = url.searchParams.get("lite") === "1";

      const hosts = getAllHostsEnriched(10000);
      const credMap = getAllHostValidatedProtocols();
      const mhMap = getAllMultihomedLinks();
      const clusterMap = getClusterDiscovery();
      const vulnMap = getAllHostsVulnSummary();
      // Utente abituale (23/11/2026): un guasto qui non deve togliere la lista, la colonna resta vuota e lo dice il journal.
      let abituali = new Map<number, UtenteAbituale>();
      try {
        const db = dbCliente();
        if (schemaAssegnatariAdPresente(db)) abituali = utentiAbituali(db);
      } catch (e) {
        console.error("[assegnatari] utente abituale nella lista degli apparati:", e);
      }

      const enriched = hosts.map((h) => {
        if (lite) {
          // Spread + delete dei blob heavy (snmp_data, conflict_flags). Mantengo
          // detection_json perché il client lo usa per fingerprint label.
          const { snmp_data: _snmp, conflict_flags: _cf, ...lean } = h;
          void _snmp; void _cf;
          return {
            ...lean,
            validated_protocols: credMap.get(h.id) || [],
            multihomed: mhMap.get(h.id) ?? null,
            cluster: clusterMap.get(h.id) ?? null,
            vuln: vulnMap.get(h.id) ?? null,
utente_abituale: abituali.get(h.id) ?? null,
          };
        }
        return {
          ...h,
          validated_protocols: credMap.get(h.id) || [],
          multihomed: mhMap.get(h.id) ?? null,
          cluster: clusterMap.get(h.id) ?? null,
          vuln: vulnMap.get(h.id) ?? null,
utente_abituale: abituali.get(h.id) ?? null,
        };
      });

      return NextResponse.json(enriched);
    } catch (error) {
      console.error("Error fetching discovery hosts:", error);
      return NextResponse.json(
        { error: "Errore nel recupero degli host" },
        { status: 500 }
      );
    }
  });
}
