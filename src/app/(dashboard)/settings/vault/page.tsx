import { auth } from "@/lib/auth";
import { PaginaVault } from "@/components/vault/pagina-vault";

export const metadata = {
  title: "Vault — DA-IPAM",
};

/** Riservata agli amministratori (piano da-vault 2026-10-23); le API lo controllano di nuovo. */
export default async function VaultPage() {
  const sessione = await auth();
  const ruolo = (sessione?.user as { role?: string } | undefined)?.role;
  if (ruolo !== "admin" && ruolo !== "superadmin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Vault</h1>
        <p className="text-sm text-muted-foreground">Pagina riservata agli amministratori di questa istanza.</p>
      </div>
    );
  }
  return <PaginaVault />;
}
