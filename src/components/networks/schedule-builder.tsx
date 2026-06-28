"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeCron, type Frequency } from "@/lib/vuln/cron-builder";

export interface ScheduleBuilderValue {
  frequency: Frequency;
  at: string;
  daysOfWeek: number[];
  dayOfMonth: number;
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Giornaliera",
  weekly: "Settimanale",
  monthly: "Mensile",
};

// Lun..Dom mappati a cron (0=Dom..6=Sab)
const WEEKDAYS: Array<{ label: string; value: number }> = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mer", value: 3 },
  { label: "Gio", value: 4 },
  { label: "Ven", value: 5 },
  { label: "Sab", value: 6 },
  { label: "Dom", value: 0 },
];

export function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleBuilderValue;
  onChange: (v: ScheduleBuilderValue) => void;
}) {
  function toggleDay(day: number) {
    const next = value.daysOfWeek.includes(day)
      ? value.daysOfWeek.filter((d) => d !== day)
      : [...value.daysOfWeek, day];
    onChange({ ...value, daysOfWeek: next.slice().sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Frequenza</Label>
          <Select
            value={value.frequency}
            onValueChange={(v) => onChange({ ...value, frequency: v as Frequency })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Orario</Label>
          <Input
            type="time"
            value={value.at}
            onChange={(e) => onChange({ ...value, at: e.target.value })}
            className="h-9 text-sm"
          />
        </div>
      </div>

      {value.frequency === "weekly" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Giorni della settimana</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const isActive = value.daysOfWeek.includes(d.value);
              return (
                <Button
                  key={d.value}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className={
                    isActive
                      ? "h-8 px-3 bg-purple-700 hover:bg-purple-800 dark:bg-purple-600 dark:hover:bg-purple-700"
                      : "h-8 px-3"
                  }
                  onClick={() => toggleDay(d.value)}
                >
                  {d.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {value.frequency === "monthly" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Giorno del mese</Label>
          <Input
            type="number"
            min={1}
            max={28}
            value={value.dayOfMonth}
            onChange={(e) => {
              const n = Number(e.target.value);
              const clamped = Number.isFinite(n) ? Math.min(28, Math.max(1, n)) : 1;
              onChange({ ...value, dayOfMonth: clamped });
            }}
            className="h-9 text-sm w-24"
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {describeCron(value)} (ora locale dell&apos;appliance edge)
      </p>
    </div>
  );
}
