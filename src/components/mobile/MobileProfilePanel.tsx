"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Smartphone, ArrowRight } from "lucide-react";

interface MobileInventory {
  serial: string | null;
  model: string | null;
  os_family: string | null;
  os_version: string | null;
  user_profile: string | null;
  imei: string | null;
  phone: string | null;
  cpu: string | null;
  battery_level: number | null;
  last_inventory_at: string | null;
}

interface MobileApp {
  package_name: string;
  app_name: string | null;
  version_name: string | null;
  last_seen: string | null;
}

interface MobileHistoryEntry {
  changed_at: string;
  change_type: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

interface MobileDetail {
  device: unknown;
  inventory: MobileInventory | null;
  apps: MobileApp[];
  history: MobileHistoryEntry[];
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value ?? "—"}</dd>
    </div>
  );
}

export function MobileProfilePanel({ hostId }: { hostId: number }) {
  const [detail, setDetail] = useState<MobileDetail | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mdm/by-host/${hostId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { detail: MobileDetail | null }) => {
        if (!cancelled) setDetail(data.detail);
      })
      .catch(() => {
        /* nessun profilo MDM: il pannello resta nascosto */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  if (!loaded || !detail) return null;

  const inv = detail.inventory;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/30 border-b py-2.5 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-primary"><Smartphone className="h-4 w-4" /></span>
          <span>Profilo MDM (Mobile)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-5">
        {inv && (
          <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <InfoRow label="Seriale" value={inv.serial} />
            <InfoRow label="Modello" value={inv.model} />
            <InfoRow label="Versione OS" value={inv.os_version} />
            <InfoRow label="Profilo utente" value={inv.user_profile} />
            <InfoRow
              label="Batteria"
              value={inv.battery_level != null ? `${inv.battery_level}%` : null}
            />
          </dl>
        )}

        {/* App installate */}
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Applicazioni installate ({detail.apps.length})
          </h4>
          {detail.apps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna applicazione rilevata.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicazione</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Versione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.apps.map((app) => (
                  <TableRow key={app.package_name}>
                    <TableCell className="font-medium">{app.app_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{app.package_name}</TableCell>
                    <TableCell className="text-xs">{app.version_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Cronologia modifiche */}
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Cronologia modifiche
          </h4>
          {detail.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna modifica registrata.</p>
          ) : (
            <ul className="space-y-2">
              {detail.history.map((h, i) => (
                <li key={`${h.changed_at}-${h.field}-${i}`} className="flex items-start gap-3 text-sm">
                  <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5 font-mono">
                    {new Date(h.changed_at).toLocaleString("it-IT")}
                  </span>
                  <div className="min-w-0">
                    <span className="font-medium">{h.field}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">({h.change_type})</span>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 flex-wrap">
                      <span className="break-all">{h.old_value ?? "—"}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="break-all text-foreground">{h.new_value ?? "—"}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
