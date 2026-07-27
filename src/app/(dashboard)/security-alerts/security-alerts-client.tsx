"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Check, Siren } from "lucide-react";

interface AlertCategoryDto {
  id: string;
  labelIt: string;
  diagnostic: boolean;
}

interface AlertEventDto {
  id: number;
  category: string;
  diagnostic: number;
  rule_id: string | null;
  rule_level: number;
  rule_description: string | null;
  agent_name: string | null;
  event_id: string | null;
  target_user: string | null;
  source_ip: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged: number;
  acknowledged_by: string | null;
}

interface AlertsResponse {
  categories: AlertCategoryDto[];
  openByCategory: Record<string, number>;
  syncState: { lastRunAt: string | null; lastError: string | null };
  events: AlertEventDto[];
}

function levelBadgeClass(level: number): string {
  if (level >= 12) return "bg-red-100 text-red-800 border-red-200";
  if (level >= 10) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

export function SecurityAlertsClient() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (category) qs.set("category", category);
      if (onlyOpen) qs.set("onlyOpen", "1");
      const res = await fetch(`/api/integrations/wazuh/alerts?${qs}`, {
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as AlertsResponse);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error(`Errore nel caricamento degli alert: ${(e as Error).message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [category, onlyOpen]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/wazuh/alerts", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
        fetched?: number;
        opened?: number;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.skipped) toast.warning(`Poll saltato: ${body.reason}`);
      else
        toast.success(
          `${body.fetched ?? 0} alert letti, ${body.opened ?? 0} nuovi eventi aperti`,
        );
      await load();
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleAck(id: number) {
    try {
      const res = await fetch(`/api/integrations/wazuh/alerts/${id}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("Evento preso in carico");
      await load();
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    }
  }

  const categories = data?.categories ?? [];
  const openCounts = data?.openByCategory ?? {};
  const events = data?.events ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Siren className="h-6 w-6" />
            Alert sicurezza
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Selezione curata degli alert Wazuh. Alert ripetuti dallo stesso agent
            sulla stessa regola sono raggruppati in un unico evento.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Aggiornamento…" : "Aggiorna ora"}
        </Button>
      </div>

      {data?.syncState.lastError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Ultimo poll fallito: {data.syncState.lastError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={category === null ? "default" : "outline"}
          size="sm"
          onClick={() => setCategory(null)}
        >
          Tutte
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={category === c.id ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(c.id)}
          >
            {c.labelIt}
            {openCounts[c.id] ? (
              <Badge className="ml-2 bg-slate-200 text-slate-800">
                {openCounts[c.id]}
              </Badge>
            ) : null}
          </Button>
        ))}
        <Button
          variant={onlyOpen ? "default" : "outline"}
          size="sm"
          className="ml-auto"
          onClick={() => setOnlyOpen((v) => !v)}
        >
          {onlyOpen ? "Solo aperti" : "Tutti gli stati"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Caricamento…" : `${events.length} eventi`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nessun evento. Se l&apos;integrazione Wazuh è appena stata configurata,
              usa &quot;Aggiorna ora&quot; per il primo poll.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Liv.</TableHead>
                    <TableHead>Regola</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Dettagli</TableHead>
                    <TableHead className="text-right">Occorrenze</TableHead>
                    <TableHead>Ultimo</TableHead>
                    <TableHead className="text-right">Azione</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id} className={e.acknowledged ? "opacity-60" : ""}>
                      <TableCell>
                        <Badge className={levelBadgeClass(e.rule_level)}>
                          {e.rule_level}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <div className="font-medium">{e.rule_description ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {categories.find((c) => c.id === e.category)?.labelIt ??
                            e.category}
                          {e.diagnostic ? " · diagnostica" : ""}
                          {e.rule_id ? ` · rule ${e.rule_id}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>{e.agent_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {e.event_id ? <div>Event ID {e.event_id}</div> : null}
                        {e.target_user ? <div>Utente: {e.target_user}</div> : null}
                        {e.source_ip ? <div>IP: {e.source_ip}</div> : null}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {e.occurrence_count}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDate(e.last_seen_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.acknowledged ? (
                          <span className="text-xs text-muted-foreground">
                            preso in carico
                            {e.acknowledged_by ? ` da ${e.acknowledged_by}` : ""}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAck(e.id)}
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Prendi in carico
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
