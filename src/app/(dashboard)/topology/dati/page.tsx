import { auth } from "@/lib/auth";
import { DatiClient } from "./dati-client";

export default async function DatiMappaPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Dati della mappa</h1>
      <DatiClient isAdmin={isAdmin} />
    </div>
  );
}
