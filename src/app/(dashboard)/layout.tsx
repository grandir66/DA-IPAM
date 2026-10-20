import { headers } from "next/headers";
import { AppShell } from "@/components/shared/app-shell";
import { HostApplianceProvider } from "@/components/shared/url-per-browser";
import { hostDellAppliance } from "@/lib/integrations/host-appliance-server";
import { hostDellaRichiesta } from "@/lib/integrations/librenms-accesso";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Host dell'appliance e Host della richiesta: i link verso i servizi della stessa
  // appliance si aprono col nome con cui l'utente ha aperto DA-IPAM (21/10).
  const hostRichiesta = hostDellaRichiesta(await headers());
  return (
    <HostApplianceProvider hostAppliance={hostDellAppliance()} hostRichiesta={hostRichiesta}>
      <AppShell>{children}</AppShell>
    </HostApplianceProvider>
  );
}
