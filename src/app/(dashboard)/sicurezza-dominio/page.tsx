import { auth } from "@/lib/auth";
import { SicurezzaDominioSchede } from "./sicurezza-dominio-schede";

export const metadata = {
  title: "Sicurezza del dominio",
};

/**
 * Eventi letti dai domain controller via WinRM, senza Wazuh (Riccardo, 29/10/2026), e Health di
 * Active Directory, scheda unita qui dalla pagina AD (Riccardo, 08/11/2026).
 */
export default async function SicurezzaDominioPage() {
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return <SicurezzaDominioSchede admin={ruolo === "admin" || ruolo === "superadmin"} />;
}
