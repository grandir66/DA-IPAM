"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

type Range = "1h" | "24h" | "7d" | "30d";

const RANGE_FROM: Record<Range, string> = {
  "1h": "-1h",
  "24h": "-1d",
  "7d": "-7d",
  "30d": "-30d",
};

interface GraphSpec {
  type: string;
  label: string;
}

const DEFAULT_GRAPHS: GraphSpec[] = [
  { type: "device_bits", label: "Traffico (bits/s)" },
  { type: "device_processor", label: "CPU" },
  { type: "device_mempool", label: "Memoria" },
  { type: "device_ping_perf", label: "Ping (latenza + loss)" },
];

interface Props {
  deviceId: number;
  graphs?: GraphSpec[];
}

/**
 * Mostra i grafici principali LibreNMS per il device dato.
 * Le PNG vengono servite via `/api/integrations/librenms/graph` (server-side
 * fetch con X-Auth-Token), quindi nessun X-Frame-Options / cert error.
 */
export function LibreNMSDeviceGraphs({ deviceId, graphs = DEFAULT_GRAPHS }: Props) {
  const [range, setRange] = useState<Range>("24h");
  const [reloadKey, setReloadKey] = useState(0);

  const ranges: Range[] = useMemo(() => ["1h", "24h", "7d", "30d"], []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-muted-foreground hover:text-foreground"
          title="Ricarica grafici"
        >
          Ricarica
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {graphs.map((g) => (
          <LibreNMSGraph
            key={`${g.type}-${range}-${reloadKey}`}
            deviceId={deviceId}
            type={g.type}
            label={g.label}
            from={RANGE_FROM[range]}
          />
        ))}
      </div>
    </div>
  );
}

interface GraphProps {
  deviceId: number;
  type: string;
  label: string;
  from: string;
}

function LibreNMSGraph({ deviceId, type, label, from }: GraphProps) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const src = `/api/integrations/librenms/graph?device_id=${deviceId}&type=${encodeURIComponent(type)}&from=${encodeURIComponent(from)}&to=now&width=1200&height=250`;

  return (
    <div className="rounded-md border border-border bg-muted/20">
      <div className="px-3 py-1.5 border-b border-border text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="relative min-h-[120px] flex items-center justify-center">
        {state === "loading" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground absolute" />
        )}
        {state === "error" && (
          <p className="text-xs text-muted-foreground py-8">
            Grafico non disponibile per questo device.
          </p>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className={`w-full ${state === "ok" ? "" : "opacity-0 h-0"}`}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      </div>
    </div>
  );
}
