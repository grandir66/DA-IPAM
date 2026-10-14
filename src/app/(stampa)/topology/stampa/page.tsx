/**
 * /topology/stampa?mappa=<id|auto>&foglio=A4|A3&scala=100|80&vm=0|1 — la mappa per la carta (spec
 * topologia §12.3). Sta fuori dal layout del cruscotto: la barra laterale e la testata dell'app non
 * si tolgono in stampa, qui non ci sono. L'accesso resta quello di tutte le pagine (proxy.ts) e la
 * pagina lo richiede di nuovo: senza sessione si va al login.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parsePrintParams } from "@/lib/topology/print-view";
import { PrintPageClient } from "@/components/topology/print/print-page-client";

export const metadata: Metadata = { title: "Stampa della mappa — DA-IPAM" };

export default async function TopologyPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <PrintPageClient initial={parsePrintParams(await searchParams)} />;
}
