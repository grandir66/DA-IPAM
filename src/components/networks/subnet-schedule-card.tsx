"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Clock, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { ScheduledJob } from "@/types";

interface SubnetScheduleCardProps {
  networkId: number;
}

const INTERVAL_OPTIONS = [
  { value: 5, label: "5 minuti" },
  { value: 10, label: "10 minuti" },
  { value: 15, label: "15 minuti" },
  { value: 30, label: "30 minuti" },
  { value: 60, label: "1 ora" },
  { value: 120, label: "2 ore" },
  { value: 360, label: "6 ore" },
  { value: 720, label: "12 ore" },
  { value: 1440, label: "1 giorno" },
];

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "mai";
  const ts = new Date(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "pochi secondi fa";
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h fa`;
  return `${Math.floor(diffH / 24)} g fa`;
}

export function SubnetScheduleCard({ networkId }: SubnetScheduleCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<ScheduledJob | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(15);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (res.ok) {
        const jobs = (await res.json()) as ScheduledJob[];
        const existing = jobs.find(
          (j) => j.network_id === networkId && j.job_type === "fast_scan"
        );
        setJob(existing ?? null);
        if (existing) setIntervalMinutes(existing.interval_minutes);
      }
    } catch (e) {
      console.error("[SubnetScheduleCard] load failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId]);

  async function createSchedule() {
    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network_id: networkId,
          job_type: "fast_scan",
          interval_minutes: intervalMinutes,
          config: {},
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Schedulazione attivata (ogni ${intervalMinutes} min)`);
      await load();
    } catch (e) {
      toast.error("Errore nell'attivazione della schedulazione");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(next: boolean) {
    if (!job) return;
    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, enabled: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(next ? "Schedulazione attiva" : "Schedulazione sospesa");
      await load();
    } catch (e) {
      toast.error("Errore");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function updateInterval() {
    if (!job) return;
    if (job.interval_minutes === intervalMinutes) return;
    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, interval_minutes: intervalMinutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Intervallo aggiornato (ogni ${intervalMinutes} min)`);
      await load();
    } catch (e) {
      toast.error("Errore nell'aggiornamento dell'intervallo");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function removeSchedule() {
    if (!job) return;
    if (!confirm("Disabilitare definitivamente la schedulazione per questa subnet?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs?id=${job.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Schedulazione rimossa");
      await load();
    } catch (e) {
      toast.error("Errore nella rimozione");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Caricamento schedulazione…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="py-2 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600" />
          Schedulazione scansione veloce
          {job?.enabled === 1 && (
            <span className="text-[10px] font-bold uppercase rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5">
              Attiva
            </span>
          )}
          {job && job.enabled !== 1 && (
            <span className="text-[10px] font-bold uppercase rounded bg-muted text-muted-foreground px-1.5 py-0.5">
              Sospesa
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2 px-4">
        {!job ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Esegui automaticamente la scansione veloce su questa subnet ogni
            </span>
            <Select
              value={String(intervalMinutes)}
              onValueChange={(v) => setIntervalMinutes(Number(v))}
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={createSchedule}
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Attiva
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={job.enabled === 1}
                onCheckedChange={toggleEnabled}
                disabled={saving}
              />
              <span className="text-sm">Esegui ogni</span>
            </div>
            <Select
              value={String(intervalMinutes)}
              onValueChange={(v) => setIntervalMinutes(Number(v))}
              disabled={saving}
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {intervalMinutes !== job.interval_minutes && (
              <Button size="sm" variant="outline" onClick={updateInterval} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Salva intervallo
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Ultima run: <b>{formatRelative(job.last_run)}</b>
              {job.next_run && job.enabled === 1 && (
                <> · Prossima: <b>{formatRelative(job.next_run)}</b></>
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={removeSchedule} disabled={saving} className="text-destructive">
              Rimuovi
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
