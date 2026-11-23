import Link from "next/link";
import { auth } from "@/lib/auth";
import { TopologyMapClient } from "@/components/topology/map/topology-map-client";

export default async function TopologyPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Topologia</h1>
        <Link href="/topology/dati" className="text-sm underline">Dati della mappa</Link>
        <Link href="/topology/tavola" className="text-sm underline">Tavola di cablaggio</Link>
      </div>
      <TopologyMapClient isAdmin={isAdmin} />
    </div>
  );
}
