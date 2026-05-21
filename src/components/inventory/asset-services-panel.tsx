"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Workflow, ExternalLink, Shield } from "lucide-react";
import type { Service } from "@/types";

interface AssetServicesPanelProps {
  assetId: number;
}

const DEP_COLORS: Record<string, string> = {
  primario: "bg-red-500/15 text-red-700 border-red-300/40 dark:text-red-400",
  secondario: "bg-amber-500/15 text-amber-700 border-amber-300/40 dark:text-amber-400",
  supporto: "bg-emerald-500/15 text-emerald-700 border-emerald-300/40 dark:text-emerald-400",
};

export function AssetServicesPanel({ assetId }: AssetServicesPanelProps) {
  const [services, setServices] = useState<Array<Service & { dependency_type: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/inventory/${assetId}/services`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : [])
      .then((d) => { if (!cancelled) setServices(Array.isArray(d) ? d : []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assetId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-5 w-5" />
          Servizi che dipendono da questo asset
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-muted-foreground py-4">Caricamento...</div>
        ) : services.length === 0 ? (
          <div className="text-muted-foreground py-6 text-sm">
            Nessun servizio collegato. Vai su <Link href="/services" className="text-primary hover:underline">/services</Link> e collega
            questo asset ai servizi pertinenti per abilitare l&apos;impact analysis NIS2.
          </div>
        ) : (
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <Link href={`/services/${s.id}`} className="font-medium text-primary hover:underline inline-flex items-center gap-1 truncate">
                      {s.name} <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                    </Link>
                    {s.description && <p className="text-xs text-muted-foreground truncate max-w-[400px]">{s.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.in_scope_nis2 ? <Badge className="bg-blue-500/15 text-blue-700 border-blue-300/40 dark:text-blue-400 text-[10px]"><Shield className="h-3 w-3 mr-1" />NIS2</Badge> : null}
                  {s.criticita_servizio && <Badge variant="outline" className="text-[10px]">{s.criticita_servizio}</Badge>}
                  <Badge variant="outline" className={`text-[10px] ${DEP_COLORS[s.dependency_type] ?? ""}`}>{s.dependency_type}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
