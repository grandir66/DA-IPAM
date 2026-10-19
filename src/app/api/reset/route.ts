import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { resetLabNetworkConfig } from "@/lib/lab-config-reset";

/**
 * «Reset per nuovo cliente» (analisi del 19/10, F02). Prima chiamava la gemella
 * di `db.ts`, che dentro un tenant cercava `users` nel DB del cliente e falliva
 * sempre. Decisione di Riccardo (19/10): via dati di rete, credenziali,
 * inventario e job; restano le impostazioni del cliente e gli utenti dell'hub.
 * È lo stesso reset del laboratorio: una funzione sola, che riapre il wizard.
 */
export async function POST() {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const tenantCode = getCurrentTenantCode();
      if (!tenantCode) return NextResponse.json({ error: "Tenant non risolto" }, { status: 400 });
      const result = resetLabNetworkConfig(tenantCode);
      return NextResponse.json({ success: true, message: "Configurazione resettata", ...result });
    } catch (error) {
      console.error("Reset configuration error:", error);
      return NextResponse.json(
        { error: "Errore durante il reset della configurazione" },
        { status: 500 }
      );
    }
  });
}
