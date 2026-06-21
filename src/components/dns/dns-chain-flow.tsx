"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Circle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DnsChain } from "@/lib/network-services/client";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <Circle
      className={`h-2.5 w-2.5 shrink-0 fill-current ${ok ? "text-emerald-500" : "text-muted-foreground/40"}`}
    />
  );
}

interface Props {
  apiBase: string;
  adblockActive: boolean;
  resolverActive: boolean;
}

export function DnsChainFlow({ apiBase, adblockActive, resolverActive }: Props) {
  const [chain, setChain] = useState<DnsChain | null>(null);

  useEffect(() => {
    void fetch("/api/network-services/dns/chain", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setChain(d.chain);
      })
      .catch(() => undefined);
    const t = setInterval(() => {
      void fetch("/api/network-services/dns/chain", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setChain(d.chain);
        })
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const lanHost = apiBase.replace(/^https?:\/\//, "").split(":")[0];
  const adGuardUp = chain?.adblock.running ?? adblockActive;
  const unboundUp = chain?.resolver.running ?? resolverActive;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Catena DNS</CardTitle>
        <CardDescription>
          Resolver LAN: <code className="font-mono">{lanHost}:53</code>
          {chain?.hint ? ` — ${chain.hint}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 min-w-[7rem]">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Client LAN</div>
            <div className="font-mono text-xs">:53</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="rounded-lg border px-3 py-2 min-w-[9rem] border-cyan-500/30 bg-cyan-500/5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground mb-1">
              <StatusDot ok={adGuardUp} />
              Filtro DNS
            </div>
            <div className="font-mono text-xs">{chain?.listen.adblock ?? "0.0.0.0:53"}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="rounded-lg border px-3 py-2 min-w-[9rem] border-blue-500/30 bg-blue-500/5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground mb-1">
              <StatusDot ok={unboundUp} />
              Resolver
            </div>
            <div className="font-mono text-xs">{chain?.listen.resolver ?? "127.0.0.1:5335"}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="rounded-lg border bg-muted/30 px-3 py-2 min-w-[9rem]">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Upstream / Auth</div>
            <div className="font-mono text-xs text-[11px] leading-snug">
              {(chain?.resolver.root_forwarders || []).join(", ") || "—"}
            </div>
            {chain?.listen.authoritative && (
              <div className="font-mono text-[10px] text-muted-foreground mt-1">
                Auth: {chain.listen.authoritative}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 text-xs">
          <div className="rounded border p-2">
            <span className="text-muted-foreground">Filtro → resolver: </span>
            <span className="font-mono">{(chain?.adblock.upstream_dns || []).join(", ") || "—"}</span>
          </div>
          <div className="rounded border p-2">
            <span className="text-muted-foreground">Forward zone Unbound: </span>
            {(chain?.resolver.forward_zones || []).filter((z) => z.zone !== ".").length === 0 ? (
              <span className="text-muted-foreground"> nessuna</span>
            ) : (
              <ul className="mt-1 space-y-0.5 font-mono">
                {(chain?.resolver.forward_zones || [])
                  .filter((z) => z.zone !== ".")
                  .map((z) => (
                    <li key={z.zone}>
                      {z.zone} → {z.targets.join(", ")}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={adGuardUp ? "default" : "secondary"}>Filtro {adGuardUp ? "attivo" : "off"}</Badge>
          <Badge variant={unboundUp ? "default" : "secondary"}>Resolver {unboundUp ? "attivo" : "off"}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
