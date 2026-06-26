"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DnsChain } from "@/lib/network-services/client";

export function DnsChainCard({ apiBase }: { apiBase: string }) {
  const [chain, setChain] = useState<DnsChain | null>(null);

  useEffect(() => {
    void fetch("/api/network-services/dns/chain", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setChain(d.chain);
      })
      .catch(() => undefined);
  }, []);

  if (!chain) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Catena DNS appliance</CardTitle>
        <CardDescription>
          Resolver LAN: <code className="font-mono">{apiBase.replace(/^https?:\/\//, "").split(":")[0]}:53</code>
          {" — "}
          {chain.hint}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-3 text-xs font-mono">
          {Object.entries(chain.listen).map(([k, v]) => (
            <div key={k} className="rounded border bg-muted/30 p-2">
              <div className="text-muted-foreground uppercase text-[10px]">{k}</div>
              <div>{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 text-xs">
          <div className="rounded border p-2">
            <span className="text-muted-foreground">AdGuard upstream → </span>
            {(chain.adblock.upstream_dns || []).join(", ") || "—"}
          </div>
          <div className="rounded border p-2">
            <span className="text-muted-foreground">Unbound root forwarders → </span>
            {(chain.resolver.root_forwarders || []).join(", ") || "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
