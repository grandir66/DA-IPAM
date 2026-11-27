import { auth } from "@/lib/auth";
import { getUsers } from "@/lib/db-hub";
import { ArchivioClient } from "./archivio-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Archivio — DA-IPAM" };

/** L'archivio delle credenziali degli utenti (ADR 0043). La pagina la vede chiunque sia collegato: cosa può fare lo decide la sua serratura. */
export default async function ArchivioPage() {
  const sessione = await auth();
  if (!sessione?.user) return null;
  const utenti = getUsers().map((u) => ({ id: u.id, nome: u.username }));
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Archivio delle credenziali</h1>
      <ArchivioClient utenti={utenti} />
    </div>
  );
}
