import { headers } from "next/headers";
import { AppShell } from "@/components/shared/app-shell";
import { HostApplianceProvider } from "@/components/shared/url-per-browser";
import { hostDellAppliance } from "@/lib/integrations/host-appliance-server";
import { hostDellaRichiesta } from "@/lib/integrations/librenms-accesso";
import { BannerVault } from "@/components/vault/banner-vault";
import { testoBannerVault } from "@/lib/vault/appliance";
import { isTecnico } from "@/lib/profilo";
import { FasciaProfilo, ProfiloInstallazioneProvider } from "@/components/profili/profilo-tecnico";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Host dell'appliance e Host della richiesta: i link verso i servizi della stessa
  // appliance si aprono col nome con cui l'utente ha aperto DA-IPAM (21/10).
  const hostRichiesta = hostDellaRichiesta(await headers());
  // da-vault: «Vault bloccato» (scansioni in pausa). Con gli interruttori spenti è sempre null: niente banner.
  const bannerVault = testoBannerVault();
  // Installazione «tecnico» (ADR 0037): selettore e fascia del profilo. Altrove false: come oggi.
  const tecnico = isTecnico();
  return (
    <HostApplianceProvider hostAppliance={hostDellAppliance()} hostRichiesta={hostRichiesta}>
      <ProfiloInstallazioneProvider tecnico={tecnico}>
        <AppShell fascia={tecnico ? <FasciaProfilo /> : null}>
          {bannerVault && <BannerVault testo={bannerVault} />}
          {children}
        </AppShell>
      </ProfiloInstallazioneProvider>
    </HostApplianceProvider>
  );
}
