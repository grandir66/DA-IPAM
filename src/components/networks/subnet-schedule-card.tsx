"use client";
import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { parseDbDate } from "@/lib/db-date";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const ts = parseDbDate(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").getTime();
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

  const isActive = job?.enabled === 1;
  const summary = !job
    ? "nessuna"
    : isActive
      ? `ogni ${intervalLabel(job.interval_minutes).toLowerCase()}${job.next_run ? ` · prossima ${formatRelative(job.next_run)}` : ""}`
      : `sospesa (${intervalLabel(job.interval_minutes).toLowerCase()})`;
  // Sul pulsante della barra lo stato in parole (Riccardo è daltonico: mai solo il colore).
  const buttonState = !job ? null : isActive ? `ogni ${intervalLabel(job.interval_minutes).toLowerCase()}` : "sospesa";

  // Pulsante nella barra delle scansioni (20/10): prima era una riga pieghevole sotto la barra.
  return (
    <>
      <Button
        size="default"
        variant="outline"
        className="h-8 min-h-8 px-2.5 text-xs font-medium shrink-0 bg-background/90"
        onClick={() => setOpen(true)}
        disabled={loading}
        title={`Scansione veloce periodica della subnet: ${summary}`}
      >
        <Clock className="h-3.5 w-3.5 mr-1 shrink-0" />
        Scansione periodica
        {buttonState && (
          <span className={isActive ? "ml-1.5 font-semibold" : "ml-1.5 text-muted-foreground"}>· {buttonState}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Scansione veloce periodica</DialogTitle>
            <DialogDescription>Ripete da sola la scansione veloce di questa subnet all&apos;intervallo scelto.</DialogDescription>
          </DialogHeader>
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
              <Button size="sm" onClick={createSchedule} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Attiva
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Accendere e sospendere la scansione veloce (tutte le reti) si fa da Opzioni (22/10). */}
              <RigheRimando ids={["job.fast_scan"]} mostraEsito={false} />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">{isActive ? "Esegui ogni" : "Sospesa; intervallo"}</span>
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
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Ultima esecuzione: <b>{formatRelative(job.last_run)}</b>
                  {job.next_run && isActive && (
                    <> · Prossima: <b>{formatRelative(job.next_run)}</b></>
                  )}
                </span>
                <Button size="sm" variant="ghost" onClick={removeSchedule} disabled={saving} className="text-destructive ml-auto">
                  Rimuovi
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
