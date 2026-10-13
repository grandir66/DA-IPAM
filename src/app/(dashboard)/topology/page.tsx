import Link from "next/link";
import { TopologyClient } from "./topology-client";

export default function TopologyPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Topologia</h1>
          <Link href="/topology/dati" className="text-sm underline">Dati della mappa</Link>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Mappa interattiva della rete. Trascina i nodi: la posizione viene salvata.
        </p>
      </div>
      <TopologyClient />
    </div>
  );
}
