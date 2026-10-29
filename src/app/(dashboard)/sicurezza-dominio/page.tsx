import { auth } from "@/lib/auth";
import { SicurezzaDominioClient } from "./sicurezza-dominio-client";

export const metadata = {
  title: "Sicurezza del dominio",
};

/** Eventi di sicurezza letti dai domain controller via WinRM, senza Wazuh (Riccardo, 29/10/2026). */
export default async function SicurezzaDominioPage() {
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  return <SicurezzaDominioClient admin={ruolo === "admin" || ruolo === "superadmin"} />;
}
