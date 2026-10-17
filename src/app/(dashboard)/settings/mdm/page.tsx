import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { livelloAlmeno } from "@/lib/permessi/politica";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getMdmConfig,
  MDM_MAX_ERRORI_CONSECUTIVI,
  MDM_SYNC_INTERVALLO_MINUTI,
  type MdmConfig,
} from "@/lib/integrations/mdm-config";
import { MdmSettingsClient } from "./MdmSettingsClient";

export const metadata = {
  title: "MDM (Headwind) — DA-IPAM",
};

export default async function MdmSettingsPage() {
  // Passo 3 (16/10): la pagina scrive credenziali e accende un job, come le sue API
  // (requireAdmin): solo per admin. Chi non lo è torna alle impostazioni.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (!livelloAlmeno(role, "admin")) redirect("/settings");

  const result = await withTenantFromSession(() => getMdmConfig());
  if (result instanceof NextResponse) {
    redirect("/login");
  }
  const config = result as MdmConfig;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">MDM (Headwind)</h1>
        <p className="text-muted-foreground mt-1">
          Configura la connessione al server Headwind MDM per importare i
          dispositivi mobili Android come host e arricchirne l&apos;inventario.
        </p>
      </div>
      <MdmSettingsClient
        config={config}
        maxErrori={MDM_MAX_ERRORI_CONSECUTIVI}
        intervalloMinuti={MDM_SYNC_INTERVALLO_MINUTI}
      />
    </div>
  );
}
