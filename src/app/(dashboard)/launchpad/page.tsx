import { listCredentials } from "@/lib/credentials-vault";
import { LaunchpadClient } from "./launchpad-client";
import { ModulesGrid } from "./modules-grid";
import { IntegrationViewer } from "@/components/integrations/integration-viewer";

/**
 * Launchpad — unico punto di accesso ai moduli e ai sistemi della stack.
 *
 * 1. Griglia moduli (stato live + Apri + Configura) — assorbe l'ex catalogo /appliance.
 * 2. Viewer dashboard in-app (LibreNMS/Graylog/...) — assorbe l'ex pagina /integrations.
 * 3. Vault credenziali di sistema (AES-GCM, reveal/launch/test con audit) — secondario.
 */
export const dynamic = "force-dynamic";

export default async function LaunchpadPage() {
  const items = listCredentials();
  return (
    <div className="space-y-8 p-1">
      <ModulesGrid />
      <IntegrationViewer />
      <div>
        <h2 className="text-lg font-semibold mb-1">Credenziali di sistema</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Vault cifrato degli accessi alla stack security. Solo admin può rivelare/modificare.
        </p>
        <LaunchpadClient initialItems={items} embedded />
      </div>
    </div>
  );
}
