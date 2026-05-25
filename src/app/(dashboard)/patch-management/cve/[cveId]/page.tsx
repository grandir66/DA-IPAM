/**
 * Patch Management — Dettaglio CVE (STUB F6 PR1).
 *
 * Implementazione vera in F7 (PR2): tabella host vulnerabili con
 * checkbox + badge choco/WinRM + bottoni Probe/Bootstrap/Patch.
 *
 * Questo stub serve a far funzionare la navigazione end-to-end dalla
 * lista CVE (F6) senza generare 404.
 */
import Link from "next/link";
import { ArrowLeft, Wrench } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function CveDetailPage({
  params,
}: {
  params: Promise<{ cveId: string }>;
}) {
  const { cveId } = await params;
  const decoded = decodeURIComponent(cveId);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/patch-management"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna alla lista
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xl">{decoded}</CardTitle>
          <CardDescription>
            Dettaglio CVE — drill-down host vulnerabili.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-start gap-2">
          <Wrench className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground mb-1">
              Funzionalità in arrivo (F7, PR2)
            </p>
            <p>
              Qui vedrai la lista degli host vulnerabili a {decoded}, con
              stato Chocolatey / WinRM per ciascun host, possibilità di
              selezione multipla e azioni di probe / bootstrap / patch.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
