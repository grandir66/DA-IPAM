"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { LaunchpadClient } from "@/app/(dashboard)/launchpad/launchpad-client";
import type { SystemCredential } from "@/lib/credentials-vault";

/** Vault credenziali — solo in Impostazioni → Moduli (non in Launchpad). */
export function CredentialsVaultPanel({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<SystemCredential[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/system-credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: SystemCredential[] } | null) => {
        setItems(d?.items ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <section className="space-y-3 pt-4 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Credenziali di sistema (vault)
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          Accessi alla stack security (Wazuh, Graylog, Tailscale, API token, …).
          Cifrate AES-GCM; reveal loggato in audit.
        </p>
      </div>
      {loaded ? (
        <LaunchpadClient initialItems={items} embedded />
      ) : (
        <div className="h-24 rounded-lg border border-border bg-card animate-pulse" />
      )}
    </section>
  );
}
