"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PackageSearch, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  const [filter, setFilter] = useState("");

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

  const filteredSoftware = useMemo(() => {
    if (!data?.software) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.software;
    return data.software.filter(
      (sw) =>
        sw.name.toLowerCase().includes(q) ||
        (sw.publisher?.toLowerCase().includes(q) ?? false) ||
        (sw.version?.toLowerCase().includes(q) ?? false),
    );
  }, [data?.software, filter]);

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
        Nessun report GLPI Agent associato a questo host (ID {hostId}). Se l&apos;endpoint compare in
        Impostazioni ma con host diverso, apri l&apos;oggetto con IP/hostname corrispondente.
      </p>
    );
  }

  const ep = data.endpoint;
  const total = data.software.length;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <PackageSearch className="h-3 w-3" />
            GLPI Agent push
          </Badge>
          <Badge variant="secondary">{total} pacchetti</Badge>
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

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Report ricevuto ma senza voci software nel parser.</p>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Filtra software…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
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
                {filteredSoftware.map((sw) => (
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
          <p className="text-[10px] text-muted-foreground">
            {filter.trim()
              ? `${filteredSoftware.length} / ${total} pacchetti`
              : `${total} pacchetti`}{" "}
            · device_id <code>{ep.device_id}</code>
          </p>
        </>
      )}
    </div>
  );
}
