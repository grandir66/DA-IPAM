"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageSearch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface InvSoftwareRow {
  id: number;
  name: string;
  version: string | null;
  publisher: string | null;
  install_date: string | null;
}

interface InvEndpoint {
  device_id: string;
  hostname: string | null;
  primary_ip: string | null;
  os_name: string | null;
  os_version: string | null;
  last_seen_at: string;
}

interface InvAgentResponse {
  enabled: boolean;
  endpoint: InvEndpoint | null;
  software: InvSoftwareRow[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

export function HostInventoryAgentCard({ hostId }: { hostId: number }) {
  const [data, setData] = useState<InvAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/hosts/${hostId}/inventory-agent`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as InvAgentResponse);
    } catch {
      toast.error("Errore caricamento inventario agent");
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento inventario agent…
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Modulo Inventory Agent non installato. Abilitalo in Impostazioni → Moduli.
      </p>
    );
  }

  if (!data.endpoint) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessun report ricevuto da GLPI Agent per questo host. Configura lo script push con token e URL ingest.
      </p>
    );
  }

  const ep = data.endpoint;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <PackageSearch className="h-3 w-3" />
            GLPI Agent push
          </Badge>
          <span>Ultimo report: {formatDate(ep.last_seen_at)}</span>
          {ep.os_name && (
            <span>
              {ep.os_name} {ep.os_version ?? ""}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void fetchData()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {data.software.length === 0 ? (
        <p className="text-sm text-muted-foreground">Report senza software catalogato.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2">Software</th>
                <th className="text-left p-2">Versione</th>
                <th className="text-left p-2">Publisher</th>
                <th className="text-left p-2">Installato</th>
              </tr>
            </thead>
            <tbody>
              {data.software.map((sw) => (
                <tr key={sw.id} className="border-t">
                  <td className="p-2">{sw.name}</td>
                  <td className="p-2 font-mono">{sw.version ?? "—"}</td>
                  <td className="p-2">{sw.publisher ?? "—"}</td>
                  <td className="p-2">{sw.install_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        {data.software.length} pacchetti · device_id <code>{ep.device_id}</code>
      </p>
    </div>
  );
}
