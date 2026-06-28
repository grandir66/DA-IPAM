"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, ExternalLink, Loader2, Save, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EdgeScanProfile, EdgeSubnetStatus, EdgeTargetingMode } from "@/lib/vuln/edge-subnet-bridge";
import { ScheduleBuilder, type ScheduleBuilderValue } from "@/components/networks/schedule-builder";
import { slugifyJobName, type Frequency } from "@/lib/vuln/cron-builder";

const SLOT_LABELS: Record<string, string> = {
  ssh: "SSH / Linux",
  smb: "Windows / SMB",
  snmp: "SNMP",
};

const PROFILE_LABELS: Record<EdgeScanProfile, string> = {
  fast: "Veloce (~15–30 min /24)",
  balanced: "Bilanciato (~1–3 h /24)",
  deep: "Profondo (~8–24 h /24)",
};

const TARGETING_MODE_LABELS: Record<EdgeTargetingMode, { label: string; desc: string }> = {
  full_subnet: {
    label: "Tutto il CIDR",
    desc: "Ogni indirizzo del range nominale della subnet.",
  },
  populated_24: {
    label: "Solo /24 popolati",
    desc: "Solo i blocchi /24 con almeno un host noto.",
  },
  found_ips: {
    label: "Solo IP che rispondono",
    desc: "Solo host online dalla discovery IPAM.",
  },
};

const SCOPE_SLUG: Record<EdgeTargetingMode, string> = {
  full_subnet: "tutto-cidr",
  populated_24: "24-popolati",
  found_ips: "ip-attivi",
};

const FREQ_LABEL: Record<Frequency, string> = {
  daily: "giornaliera",
  weekly: "settimanale",
  monthly: "mensile",
};

interface SavedSchedule {
  job_name: string | null;
  frequency: Frequency | null;
  at_time: string | null;
  days_of_week: string | null; // CSV "1,2,3"
  day_of_month: number | null;
  profile: EdgeScanProfile | null;
  targeting_mode: EdgeTargetingMode | null;
  enabled: boolean;
}

function parseDaysCsv(csv: string | null): number[] {
  if (!csv) return [1];
  const days = csv
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return days.length ? days : [1];
}

function cidrAddressCount(cidr: string): number {
  const slash = cidr.lastIndexOf("/");
  if (slash === -1) return 0;
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return 0;
  // 2 ** (...) evita l'overflow a 32 bit di `1 << (32 - prefix)` (errato per /0, /1).
  return Math.max(0, 2 ** (32 - prefix) - 2);
}

function get24Prefix(ip: string): string {
  // Solo IPv4: un IPv6 (con ':') non va raggruppato per /24.
  if (!ip.includes(".")) return ip;
  const parts = ip.split(".");
  if (parts.length < 3) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
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

interface SubnetEdgeScanPanelProps {
  networkId: number;
  disabled?: boolean;
  hosts?: Array<{ ip: string; status: string }>;
  cidr?: string;
  networkName?: string;
}

export function SubnetEdgeScanPanel({ networkId, disabled, hosts, cidr, networkName }: SubnetEdgeScanPanelProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EdgeSubnetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [profile, setProfile] = useState<EdgeScanProfile>("balanced");
  const [syncHosts, setSyncHosts] = useState(true);
  const [syncCredentials, setSyncCredentials] = useState(true);
  const [targetingMode, setTargetingMode] = useState<EdgeTargetingMode>("full_subnet");

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleProfile, setScheduleProfile] = useState<EdgeScanProfile>("balanced");
  const [hasSchedule, setHasSchedule] = useState(false);
  const [sched, setSched] = useState<ScheduleBuilderValue>({
    frequency: "monthly",
    at: "10:00",
    daysOfWeek: [1],
    dayOfMonth: 1,
  });
  const [jobName, setJobName] = useState("");
  const [jobNameTouched, setJobNameTouched] = useState(false);

  // Live counts from hosts prop (when available)
  const foundCount = hosts ? hosts.filter((h) => h.status !== "offline").length : null;
  const populated24Count = hosts
    ? new Set(
        hosts
          .filter((h) => h.status !== "offline")
          .map((h) => get24Prefix(h.ip)),
      ).size
    : null;
  const resolvedCidr = cidr ?? status?.edgeNetwork?.cidr;
  const fullSubnetCount = resolvedCidr ? cidrAddressCount(resolvedCidr) : null;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/networks/${networkId}/edge-scan`);
      if (r.ok) {
        const data = (await r.json()) as EdgeSubnetStatus & { savedSchedule?: SavedSchedule | null };
        setStatus(data);
        const saved = data.savedSchedule ?? null;
        // La modalità targeting può vivere sia in savedSchedule sia nello status: preferisci il salvato.
        setTargetingMode(saved?.targeting_mode ?? data.targeting_mode ?? "full_subnet");
        if (saved) {
          setHasSchedule(true);
          setScheduleEnabled(saved.enabled);
          setScheduleProfile(saved.profile ?? "balanced");
          if (saved.job_name) {
            setJobName(saved.job_name);
            setJobNameTouched(true);
          }
          setSched({
            frequency: saved.frequency ?? "monthly",
            at: saved.at_time ?? "10:00",
            daysOfWeek: parseDaysCsv(saved.days_of_week),
            dayOfMonth: saved.day_of_month ?? 1,
          });
        } else {
          setHasSchedule(false);
          setScheduleEnabled(false);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [networkId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Auto-compila il nome job finché l'utente non lo modifica a mano.
  useEffect(() => {
    if (jobNameTouched) return;
    const auto = slugifyJobName([
      networkName ?? "",
      resolvedCidr ?? "",
      SCOPE_SLUG[targetingMode],
      FREQ_LABEL[sched.frequency],
    ]);
    setJobName(auto);
  }, [jobNameTouched, networkName, resolvedCidr, targetingMode, sched.frequency]);

  async function handleScan() {
    setScanning(true);
    try {
      const r = await fetch(`/api/networks/${networkId}/edge-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, sync_hosts: syncHosts, sync_credentials: syncCredentials, targeting_mode: targetingMode }),
      });
      const d = (await r.json()) as { ok?: boolean; scan_id?: number; host_count?: number; error?: string };
      if (r.ok && d.ok) {
        toast.success(
          `Scan VA avviato (#${d.scan_id ?? "?"})` +
            (d.host_count != null ? ` — ${d.host_count} host target` : ""),
        );
        await refresh();
      } else {
        toast.error(d.error || "Avvio scan VA fallito");
      }
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveSchedule() {
    if (!jobName.trim()) {
      toast.error("Indica un nome job/report");
      return;
    }
    setSavingSchedule(true);
    try {
      const r = await fetch(`/api/networks/${networkId}/edge-scan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: scheduleEnabled,
          profile: scheduleProfile,
          targeting_mode: targetingMode,
          job_name: jobName.trim(),
          frequency: sched.frequency,
          at_time: sched.at,
          days_of_week: sched.frequency === "weekly" ? sched.daysOfWeek : undefined,
          day_of_month: sched.frequency === "monthly" ? sched.dayOfMonth : undefined,
        }),
      });
      const d = (await r.json()) as EdgeSubnetStatus & {
        ok?: boolean;
        error?: string;
        degraded?: boolean;
        warning?: string;
      };
      if (r.ok && d.ok !== false && !d.error) {
        toast.success(
          scheduleEnabled
            ? "Schedulazione VA attiva"
            : "Schedulazione VA salvata (sospesa)",
        );
        if (d.degraded && d.warning) {
          toast.warning(d.warning);
        }
        setHasSchedule(true);
        setStatus(d);
      } else {
        toast.error(d.error || "Salvataggio schedulazione fallito");
      }
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleRemoveSchedule() {
    if (!confirm("Rimuovere la schedulazione VA Scan per questa subnet?")) return;
    setSavingSchedule(true);
    try {
      const r = await fetch(`/api/networks/${networkId}/edge-scan`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && d.ok) {
        toast.success("Schedulazione rimossa");
        setHasSchedule(false);
        setScheduleEnabled(false);
        await refresh();
      } else {
        toast.error(d.error || "Rimozione fallita");
      }
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setSavingSchedule(false);
    }
  }

  const last = status?.edgeNetwork?.last_scan;
  const schedRun = status?.edgeNetwork?.schedule;
  const edgeCreds = status?.edgeNetwork?.credentials;
  const ipamCreds = status?.ipamCredentials ?? [];
  const scheduleActive = schedRun?.enabled === 1;

  const summaryBadge = !status?.edgeConfigured
    ? null
    : scheduleActive
      ? "Sched. attiva"
      : last?.status === "running"
        ? "In corso"
        : last?.status === "done"
          ? "Ultimo OK"
          : last?.status === "error"
            ? "Errore"
            : null;

  const triggerButtonClass =
    "w-full h-8 min-h-8 px-2.5 text-xs font-medium bg-purple-700 hover:bg-purple-800 dark:bg-purple-600 dark:hover:bg-purple-700";

  if (loading) {
    return (
      <Button size="default" variant="default" className={triggerButtonClass} disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 shrink-0" />
        VA Scan…
      </Button>
    );
  }

  if (!status?.edgeConfigured) {
    return (
      <Button
        size="default"
        variant="default"
        className={`${triggerButtonClass} opacity-60`}
        disabled
        title="Scanner VA non configurato — abilita il modulo Vulnerability Assessment"
      >
        <ShieldAlert className="h-3.5 w-3.5 mr-1 shrink-0" />
        VA Scan
      </Button>
    );
  }

  return (
    <>
      <Button
        size="default"
        variant="default"
        className={triggerButtonClass}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Avvia o schedula VA Scan su questa subnet"
      >
        <ShieldAlert className="h-3.5 w-3.5 mr-1 shrink-0" />
        VA Scan
        {summaryBadge && (
          <Badge
            variant="outline"
            className="ml-1.5 h-5 px-1.5 text-[10px] font-semibold border-white/40 text-white bg-white/10"
          >
            {summaryBadge}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-purple-600" />
              VA Scan
            </DialogTitle>
            <DialogDescription>
              {status.scannerName}
              {status.edgeNetwork
                ? ` · rete edge #${status.edgeNetwork.network_id} · ${status.edgeNetwork.cidr}`
                : " · la rete verrà registrata sull'edge al primo scan"}
            </DialogDescription>
          </DialogHeader>

          {last && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
              <p>
                <span className="text-muted-foreground">Ultimo scan:</span>{" "}
                <strong>{last.status}</strong>
                {last.finding_count > 0 && ` · ${last.finding_count} CVE`}
              </p>
              <p className="text-muted-foreground">
                {last.started_at && <>Inizio {formatRelative(last.started_at)}</>}
                {last.finished_at && <> · Fine {formatRelative(last.finished_at)}</>}
              </p>
            </div>
          )}

          {/* Layout a 2 colonne: sinistra = scope + scan manuale + credenziali, destra = schedulazione */}
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {/* ─────────────── Colonna sinistra ─────────────── */}
            <div className="space-y-4">
              {/* ─── Modalità targeting (condivisa tra scan manuale e schedulazione) ─── */}
              <div>
                <p className="text-sm font-medium mb-2">Modalità targeting</p>
                <div className="space-y-1.5">
                  {(Object.keys(TARGETING_MODE_LABELS) as EdgeTargetingMode[]).map((mode) => {
                    const isActive = targetingMode === mode;
                    let countLabel = "";
                    if (mode === "found_ips") {
                      countLabel = foundCount !== null ? ` · ${foundCount} host` : "";
                    } else if (mode === "populated_24") {
                      const est = populated24Count !== null ? populated24Count * 254 : null;
                      countLabel =
                        populated24Count !== null
                          ? ` · ${populated24Count} /24${est !== null ? ` · fino a ~${est} indirizzi` : ""}`
                          : "";
                    } else if (mode === "full_subnet") {
                      countLabel = fullSubnetCount !== null && fullSubnetCount > 0 ? ` · ${fullSubnetCount} indirizzi` : resolvedCidr ? ` · ${resolvedCidr}` : "";
                    }
                    return (
                      <label
                        key={mode}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-1.5 cursor-pointer transition-colors ${isActive ? "border-purple-500 bg-purple-500/10" : "border-border bg-muted/20 hover:bg-muted/40"}`}
                      >
                        <input
                          type="radio"
                          name={`targeting-mode-${networkId}`}
                          value={mode}
                          checked={isActive}
                          onChange={() => setTargetingMode(mode)}
                          className="accent-purple-600 mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="text-sm font-medium">
                            {TARGETING_MODE_LABELS[mode].label}
                            {countLabel && (
                              <span className="text-xs font-normal text-muted-foreground ml-1">{countLabel}</span>
                            )}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {TARGETING_MODE_LABELS[mode].desc}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* ─── VA Scan manuale ─── */}
              <div>
                <p className="text-sm font-medium mb-2">VA Scan manuale</p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Profilo</Label>
                    <Select value={profile} onValueChange={(v) => setProfile(v as EdgeScanProfile)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PROFILE_LABELS) as EdgeScanProfile[]).map((p) => (
                          <SelectItem key={p} value={p}>
                            {PROFILE_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`edge-sync-modal-${networkId}`}
                        checked={syncHosts}
                        onCheckedChange={setSyncHosts}
                        disabled={scanning || disabled || !status.edgeEnabled}
                      />
                      <Label htmlFor={`edge-sync-modal-${networkId}`} className="text-xs leading-snug cursor-pointer">
                        Sync host online da IPAM prima dello scan
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`edge-cred-sync-${networkId}`}
                        checked={syncCredentials}
                        onCheckedChange={setSyncCredentials}
                        disabled={scanning || disabled || !status.edgeEnabled}
                      />
                      <Label htmlFor={`edge-cred-sync-${networkId}`} className="text-xs leading-snug cursor-pointer">
                        Trasferisci credenziali subnet allo scanner (SSH / WinRM / SNMP)
                      </Label>
                    </div>
                  </div>
                </div>
                <Button
                  className="mt-3 w-full bg-purple-700 hover:bg-purple-800 dark:bg-purple-600"
                  onClick={() => void handleScan()}
                  disabled={scanning || disabled || !status.edgeEnabled}
                >
                  {scanning ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 mr-2" />
                  )}
                  Avvia VA Scan
                </Button>
              </div>

              {(ipamCreds.length > 0 || edgeCreds) && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">Credenziali subnet</p>
                    {ipamCreds.length > 0 ? (
                      <ul className="text-xs space-y-1 rounded-md border bg-muted/20 p-2 max-h-36 overflow-y-auto">
                        {ipamCreds.map((c, i) => (
                          <li key={`${c.credential_id ?? "c"}-${i}`} className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px] h-5">
                              {c.credential_type}
                            </Badge>
                            <span className="font-medium">{c.name}</span>
                            {c.slot && (
                              <span className="text-muted-foreground">
                                → {SLOT_LABELS[c.slot] ?? c.slot}
                                {c.selected_for_scan ? " (attiva scan)" : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nessuna credenziale associata a questa subnet in IPAM.
                      </p>
                    )}
                    {edgeCreds && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Credenziali attive sullo scanner:{" "}
                        {[
                          edgeCreds.ssh?.name && `SSH=${edgeCreds.ssh.name}`,
                          edgeCreds.smb?.name && `SMB=${edgeCreds.smb.name}`,
                          edgeCreds.snmp?.name && `SNMP=${edgeCreds.snmp.name}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "nessuna assegnata"}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ─────────────── Colonna destra: schedulazione ─────────────── */}
            <div className="md:border-l md:pl-6">
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-600" />
                  Schedulazione ricorrente
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Lo scan parte sull&apos;edge alla cadenza scelta (orario notturno consigliato per profili bilanciato/profondo).
                </p>

                <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={scheduleEnabled}
                        onCheckedChange={setScheduleEnabled}
                        disabled={savingSchedule || !status.edgeEnabled}
                      />
                      <Label className="text-sm">Attiva</Label>
                    </div>
                    <Select
                      value={scheduleProfile}
                      onValueChange={(v) => setScheduleProfile(v as EdgeScanProfile)}
                      disabled={savingSchedule || !status.edgeEnabled}
                    >
                      <SelectTrigger className="w-[180px] h-9">
                        <SelectValue placeholder="Profilo" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PROFILE_LABELS) as EdgeScanProfile[]).map((p) => (
                          <SelectItem key={p} value={p}>
                            {PROFILE_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <ScheduleBuilder value={sched} onChange={setSched} />

                  <div className="space-y-1.5">
                    <Label htmlFor={`edge-job-name-${networkId}`} className="text-xs">
                      Nome job/report
                    </Label>
                    <Input
                      id={`edge-job-name-${networkId}`}
                      value={jobName}
                      onChange={(e) => {
                        setJobNameTouched(true);
                        setJobName(e.target.value);
                      }}
                      placeholder="es. rete-uffici_10-0-0-0-24_tutto-cidr_mensile"
                      className="h-9 text-sm"
                      disabled={savingSchedule || !status.edgeEnabled}
                    />
                  </div>

                  {schedRun && (
                    <p className="text-xs text-muted-foreground">
                      Ultima esecuzione: <strong>{formatRelative(schedRun.last_run_at)}</strong>
                      {schedRun.last_run_status && ` (${schedRun.last_run_status})`}
                      {scheduleActive && schedRun.next_run_at && (
                        <> · Prossima: <strong>{formatRelative(schedRun.next_run_at)}</strong></>
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handleSaveSchedule()}
                      disabled={savingSchedule || !status.edgeEnabled}
                      className="bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      {savingSchedule ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      {hasSchedule ? "Salva schedulazione" : "Crea schedulazione"}
                    </Button>
                    {hasSchedule && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void handleRemoveSchedule()}
                        disabled={savingSchedule}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Rimuovi
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <Link
              href="/vulnerabilities"
              className="inline-flex items-center text-sm text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Findings in IPAM
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Link>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
