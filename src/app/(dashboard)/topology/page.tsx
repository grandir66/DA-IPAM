import { auth } from "@/lib/auth";
import { TopologyMapClient } from "@/components/topology/map/topology-map-client";

export default async function TopologyPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">Topologia</h1>
      <TopologyMapClient isAdmin={isAdmin} />
    </div>
  );
}
