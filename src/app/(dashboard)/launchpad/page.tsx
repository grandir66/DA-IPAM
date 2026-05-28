import { listCredentials } from "@/lib/credentials-vault";
import { LaunchpadClient } from "./launchpad-client";

/**
 * Launchpad — entry point unificato per accesso ai sistemi della stack security.
 * Aggrega credenziali (vault cifrato AES-GCM) di tutti gli ambienti gestiti:
 * Wazuh, Graylog, LibreNMS, Scanner-Edge, DA-Vul-can hub, Tailscale PVE, ecc.
 *
 * Solo admin può rivelare/modificare i secret. Audit log obbligatorio.
 */
export const dynamic = "force-dynamic";

export default async function LaunchpadPage() {
  const items = listCredentials();
  return <LaunchpadClient initialItems={items} />;
}
