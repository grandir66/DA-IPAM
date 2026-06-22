import { ModulesGrid } from "./modules-grid";

/**
 * Launchpad — accesso rapido ai soli moduli attivi e funzionanti.
 * Configurazione, credenziali vault e dashboard in-app → Impostazioni → Moduli.
 */
export const dynamic = "force-dynamic";

export default function LaunchpadPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Launchpad</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Accesso rapido ai moduli attivi. Per configurare Wazuh, Graylog, credenziali e
          integrazioni vai a{" "}
          <a href="/settings?tab=moduli" className="text-primary underline-offset-2 hover:underline">
            Impostazioni → Moduli
          </a>
          .
        </p>
      </div>
      <ModulesGrid mode="launchpad" />
    </div>
  );
}
