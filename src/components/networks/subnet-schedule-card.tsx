"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Clock, Loader2, Save } from "lucide-react";
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
  const absMin = Math.floor(Math.abs(diffMs) / 60000);
  const suffix = diffMs >= 0 ? "fa" : "tra";
  if (absMin < 1) return diffMs >= 0 ? "pochi secondi fa" : "a breve";
  if (absMin < 60) return `${suffix} ${absMin} min`;
  const absH = Math.floor(absMin / 60);
  if (absH < 24) return `${suffix} ${absH} h`;
  return `${suffix} ${Math.floor(absH / 24)} g`;
}

function intervalLabel(min: number): string {
  const found = INTERVAL_OPTIONS.find((o) => o.value === min);
  return found ? found.label : `${min} min`;
}

export function SubnetScheduleCard({ networkId }: SubnetScheduleCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
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
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      toast.success(`Schedulazione attivata (ogni ${intervalMinutes} min)`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "errore";
      toast.error(`Errore nell'attivazione: ${msg}`);
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

  if (loading) return null;

  const isActive = job?.enabled === 1;
  const summary = !job
    ? "nessuna"
    : isActive
      ? `ogni ${intervalLabel(job.interval_minutes).toLowerCase()}${job.next_run ? ` · prossima ${formatRelative(job.next_run)}` : ""}`
      : `sospesa (${intervalLabel(job.interval_minutes).toLowerCase()})`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between rounded-md border border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors px-3 py-1.5 text-left">
          <span className="flex items-center gap-2 text-xs font-medium">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            Schedulazione scansione veloce
            {isActive && (
              <span className="text-[10px] font-bold uppercase rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5">
                Attiva
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 mt-1">
          {!job ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Esegui automaticamente la scansione veloce ogni
              </span>
              <Select
                value={String(intervalMinutes)}
                onValueChange={(v) => setIntervalMinutes(Number(v))}
              >
                <SelectTrigger className="w-[130px] h-8">
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
                <SelectTrigger className="w-[130px] h-8">
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
                {job.next_run && isActive && (
                  <> · Prossima: <b>{formatRelative(job.next_run)}</b></>
                )}
              </span>
              <Button size="sm" variant="ghost" onClick={removeSchedule} disabled={saving} className="text-destructive">
                Rimuovi
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
