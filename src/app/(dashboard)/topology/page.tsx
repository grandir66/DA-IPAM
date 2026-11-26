import { auth } from "@/lib/auth";
import { TopologyMapClient } from "@/components/topology/map/topology-map-client";

export default async function TopologyPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";
  return (
    <div>
      {/* Il nome lo dicono già menu e schede (Riccardo, 24/11/2026): il titolo resta solo per i lettori di schermo. */}
      <h1 className="sr-only">Topologia</h1>
      <TopologyMapClient isAdmin={isAdmin} />
    </div>
  );
}
