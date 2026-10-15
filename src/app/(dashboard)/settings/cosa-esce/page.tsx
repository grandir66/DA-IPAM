import { auth } from "@/lib/auth";
import { CosaEsce } from "@/components/settings/cosa-esce";

export const metadata = {
  title: "Cosa esce — DA-IPAM",
};

/** Riservata agli amministratori dell'istanza (spec NetBird §5.3); l'API lo controlla di nuovo. */
export default async function CosaEscePage() {
  const sessione = await auth();
  const ruolo = (sessione?.user as { role?: string } | undefined)?.role;
  if (ruolo !== "admin" && ruolo !== "superadmin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Cosa esce da questa istanza verso Domarc</h1>
        <p className="text-sm text-muted-foreground">Pagina riservata agli amministratori di questa istanza.</p>
      </div>
    );
  }
  return <CosaEsce />;
}
