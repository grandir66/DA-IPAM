"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel, sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { DeviceFingerprintSnapshot } from "@/types";

const SORTED_CLASSIFICATIONS = sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED);

interface CreateFingerprintRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fingerprint: DeviceFingerprintSnapshot;
  currentClassification?: string | null;
  hostIp: string;
  hostname?: string | null;
  onCreated?: () => void;
}

/** Porte note da escludere dal pre-fill (troppo generiche). */
const NOISE_PORTS = new Set([80, 443, 8080, 8443]);

function buildDefaultName(fp: DeviceFingerprintSnapshot, ip: string): string {
  const label = fp.final_device ?? "Dispositivo";
  return `Regola da ${label} (${ip})`;
}

function simplifyRegex(text: string | null | undefined): string {
  if (!text) return "";
  // Prendi le prime parole significative (fino a 60 char), escape speciali regex
  const trimmed = text.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return trimmed;
}

function computeTtlRange(ttl: number | null | undefined): { min: number; max: number } | null {
  if (ttl == null) return null;
  if (ttl >= 120 && ttl <= 128) return { min: 65, max: 128 }; // Windows
  if (ttl >= 60 && ttl <= 64) return { min: 33, max: 64 }; // Linux
  if (ttl >= 250 && ttl <= 255) return { min: 200, max: 255 }; // Network devices
  return { min: Math.max(1, ttl - 10), max: Math.min(255, ttl + 5) };
}

interface CriterionField<T> {
  enabled: boolean;
  value: T;
}

interface RuleForm {
  name: string;
  device_label: string;
  classification: string;
  priority: number;
  tcp_ports_key: CriterionField<string>;
  tcp_ports_optional: CriterionField<string>;
  min_key_ports: number;
  oid_prefix: CriterionField<string>;
  sysdescr_pattern: CriterionField<string>;
  hostname_pattern: CriterionField<string>;
  mac_vendor_pattern: CriterionField<string>;
  banner_pattern: CriterionField<string>;
  ttl_min: CriterionField<number | null>;
  ttl_max: CriterionField<number | null>;
  note: string;
  also_create_classification_map: boolean;
}

function buildInitialForm(fp: DeviceFingerprintSnapshot, ip: string, currentClassification?: string | null): RuleForm {
  const significantPorts = fp.open_ports.filter((p) => !NOISE_PORTS.has(p));
  const ttlRange = computeTtlRange(fp.ttl);

  return {
    name: buildDefaultName(fp, ip),
    device_label: fp.final_device ?? "",
    classification: currentClassification ?? "",
    priority: 50,
    tcp_ports_key: {
      enabled: significantPorts.length > 0,
      value: JSON.stringify(significantPorts),
    },
    tcp_ports_optional: { enabled: false, value: "[]" },
    min_key_ports: Math.max(1, significantPorts.length - 1),
    oid_prefix: {
      enabled: !!fp.snmp_vendor_oid,
      value: fp.snmp_vendor_oid ?? "",
    },
    sysdescr_pattern: {
      enabled: !!fp.snmp_sysdescr,
      value: simplifyRegex(fp.snmp_sysdescr),
    },
    hostname_pattern: {
      enabled: false,
      value: fp.hostname ? `^${simplifyRegex(fp.hostname.split(".")[0])}` : "",
    },
    mac_vendor_pattern: { enabled: false, value: "" },
    banner_pattern: {
      enabled: !!(fp.banner_ssh || fp.banner_http),
      value: simplifyRegex(fp.banner_ssh || fp.banner_http),
    },
    ttl_min: { enabled: !!ttlRange, value: ttlRange?.min ?? null },
    ttl_max: { enabled: !!ttlRange, value: ttlRange?.max ?? null },
    note: "",
    also_create_classification_map: false,
  };
}

export function CreateFingerprintRuleDialog({
  open, onOpenChange, fingerprint, currentClassification, hostIp, hostname, onCreated,
}: CreateFingerprintRuleDialogProps) {
  const [form, setForm] = useState<RuleForm>(() => buildInitialForm(fingerprint, hostIp, currentClassification));
  const [saving, setSaving] = useState(false);

  // Quando il dialog si apre con un fingerprint diverso, reset form
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setForm(buildInitialForm(fingerprint, hostIp, currentClassification));
    }
    onOpenChange(nextOpen);
  }

  function updateCriterion<K extends keyof RuleForm>(key: K, patch: Partial<CriterionField<unknown>>) {
    setForm((prev) => {
      const current = prev[key] as CriterionField<unknown>;
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  async function handleSave() {
    if (!form.name.trim() || !form.device_label.trim() || !form.classification) {
      toast.error("Nome, etichetta dispositivo e classificazione sono obbligatori");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        device_label: form.device_label.trim(),
        classification: form.classification,
        priority: form.priority,
        note: form.note || null,
      };

      if (form.tcp_ports_key.enabled && form.tcp_ports_key.value) {
        payload.tcp_ports_key = form.tcp_ports_key.value;
        payload.min_key_ports = form.min_key_ports;
      }
      if (form.tcp_ports_optional.enabled && form.tcp_ports_optional.value) {
        payload.tcp_ports_optional = form.tcp_ports_optional.value;
      }
      if (form.oid_prefix.enabled && form.oid_prefix.value) {
        payload.oid_prefix = form.oid_prefix.value;
      }
      if (form.sysdescr_pattern.enabled && form.sysdescr_pattern.value) {
        payload.sysdescr_pattern = form.sysdescr_pattern.value;
      }
      if (form.hostname_pattern.enabled && form.hostname_pattern.value) {
        payload.hostname_pattern = form.hostname_pattern.value;
      }
      if (form.mac_vendor_pattern.enabled && form.mac_vendor_pattern.value) {
        payload.mac_vendor_pattern = form.mac_vendor_pattern.value;
      }
      if (form.banner_pattern.enabled && form.banner_pattern.value) {
        payload.banner_pattern = form.banner_pattern.value;
      }
      if (form.ttl_min.enabled && form.ttl_min.value != null) {
        payload.ttl_min = form.ttl_min.value;
      }
      if (form.ttl_max.enabled && form.ttl_max.value != null) {
        payload.ttl_max = form.ttl_max.value;
      }

      const res = await fetch("/api/fingerprint-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Errore nella creazione della regola");
        return;
      }

      // Opzionalmente crea anche una regola di classificazione
      if (form.also_create_classification_map && form.device_label.trim()) {
        try {
          await fetch("/api/fingerprint-classification-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              match_kind: "exact",
              pattern: form.device_label.trim(),
              classification: form.classification,
              priority: form.priority,
              enabled: true,
            }),
          });
        } catch {
          // Non critico se fallisce
        }
      }

      toast.success("Regola creata. Le prossime scansioni la applicheranno.");
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast.error("Errore nella creazione della regola");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
        <DialogHeader>
          <DialogTitle>Crea regola da fingerprint</DialogTitle>
        </DialogHeader>
        <DialogScrollableArea className="max-h-[70vh]">
          <div className="space-y-5 p-1">
            {/* ── Riepilogo fingerprint corrente ── */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Fingerprint corrente</p>
              <div className="flex flex-wrap gap-1.5">
                {fingerprint.final_device && (
                  <Badge variant="secondary" className="text-xs">{fingerprint.final_device}</Badge>
                )}
                {fingerprint.final_confidence != null && fingerprint.final_confidence > 0 && (
                  <Badge variant="outline" className="text-xs">{Math.round(fingerprint.final_confidence * 100)}%</Badge>
                )}
                {fingerprint.detection_sources?.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Host: {hostIp}{hostname ? ` (${hostname})` : ""} — Porte: {fingerprint.open_ports.join(", ") || "nessuna"}
              </p>
            </div>

            {/* ── Identificazione ── */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Identificazione</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome regola</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Es: MikroTik RouterOS (porte+OID)"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Etichetta dispositivo</Label>
                  <Input
                    value={form.device_label}
                    onChange={(e) => setForm({ ...form, device_label: e.target.value })}
                    placeholder="Es: MikroTik RouterOS"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Classificazione</Label>
                  <Select value={form.classification || "__empty__"} onValueChange={(v) => setForm({ ...form, classification: v === "__empty__" ? "" : (v ?? "") })}>
                    <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty__">— Seleziona —</SelectItem>
                      {SORTED_CLASSIFICATIONS.map((c) => (
                        <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Priorità (minore = più importante)</Label>
                  <Input
                    type="number" min={1} max={100}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 50 })}
                  />
                </div>
              </div>
            </div>

            {/* ── Criteri di match ── */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Criteri di match</h4>
              <p className="text-xs text-muted-foreground">
                Abilita solo i criteri significativi. I campi disabilitati non vengono salvati nella regola.
              </p>

              {/* Porte TCP chiave */}
              <CriterionRow
                label="Porte TCP chiave"
                enabled={form.tcp_ports_key.enabled}
                onToggle={(v) => updateCriterion("tcp_ports_key", { enabled: v })}
              >
                <Input
                  value={form.tcp_ports_key.value}
                  onChange={(e) => updateCriterion("tcp_ports_key", { value: e.target.value })}
                  placeholder='[8006, 22]'
                  className="font-mono text-xs"
                  disabled={!form.tcp_ports_key.enabled}
                />
                <div className="flex items-center gap-2 mt-1">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Min. porte richieste:</Label>
                  <Input
                    type="number" min={1} max={20}
                    value={form.min_key_ports}
                    onChange={(e) => setForm({ ...form, min_key_ports: Number(e.target.value) || 1 })}
                    className="w-16 h-7 text-xs"
                    disabled={!form.tcp_ports_key.enabled}
                  />
                </div>
              </CriterionRow>

              {/* Porte TCP opzionali */}
              <CriterionRow
                label="Porte TCP opzionali"
                enabled={form.tcp_ports_optional.enabled}
                onToggle={(v) => updateCriterion("tcp_ports_optional", { enabled: v })}
              >
                <Input
                  value={form.tcp_ports_optional.value}
                  onChange={(e) => updateCriterion("tcp_ports_optional", { value: e.target.value })}
                  placeholder='[3128, 8007]'
                  className="font-mono text-xs"
                  disabled={!form.tcp_ports_optional.enabled}
                />
              </CriterionRow>

              {/* OID Prefix */}
              <CriterionRow
                label="OID Prefix (SNMP)"
                enabled={form.oid_prefix.enabled}
                onToggle={(v) => updateCriterion("oid_prefix", { enabled: v })}
              >
                <Input
                  value={form.oid_prefix.value}
                  onChange={(e) => updateCriterion("oid_prefix", { value: e.target.value })}
                  placeholder="1.3.6.1.4.1.14988.1"
                  className="font-mono text-xs"
                  disabled={!form.oid_prefix.enabled}
                />
              </CriterionRow>

              {/* sysDescr pattern */}
              <CriterionRow
                label="Pattern sysDescr"
                enabled={form.sysdescr_pattern.enabled}
                onToggle={(v) => updateCriterion("sysdescr_pattern", { enabled: v })}
              >
                <Input
                  value={form.sysdescr_pattern.value}
                  onChange={(e) => updateCriterion("sysdescr_pattern", { value: e.target.value })}
                  placeholder="routeros|mikrotik"
                  className="font-mono text-xs"
                  disabled={!form.sysdescr_pattern.enabled}
                />
              </CriterionRow>

              {/* Hostname pattern */}
              <CriterionRow
                label="Pattern hostname"
                enabled={form.hostname_pattern.enabled}
                onToggle={(v) => updateCriterion("hostname_pattern", { enabled: v })}
              >
                <Input
                  value={form.hostname_pattern.value}
                  onChange={(e) => updateCriterion("hostname_pattern", { value: e.target.value })}
                  placeholder="^ap[-_]"
                  className="font-mono text-xs"
                  disabled={!form.hostname_pattern.enabled}
                />
              </CriterionRow>

              {/* MAC Vendor pattern */}
              <CriterionRow
                label="Pattern MAC vendor"
                enabled={form.mac_vendor_pattern.enabled}
                onToggle={(v) => updateCriterion("mac_vendor_pattern", { enabled: v })}
              >
                <Input
                  value={form.mac_vendor_pattern.value}
                  onChange={(e) => updateCriterion("mac_vendor_pattern", { value: e.target.value })}
                  placeholder="ubiquiti|mikrotik"
                  className="font-mono text-xs"
                  disabled={!form.mac_vendor_pattern.enabled}
                />
              </CriterionRow>

              {/* Banner pattern */}
              <CriterionRow
                label="Pattern banner (HTTP/SSH)"
                enabled={form.banner_pattern.enabled}
                onToggle={(v) => updateCriterion("banner_pattern", { enabled: v })}
              >
                <Input
                  value={form.banner_pattern.value}
                  onChange={(e) => updateCriterion("banner_pattern", { value: e.target.value })}
                  placeholder="proxmox|pve-manager"
                  className="font-mono text-xs"
                  disabled={!form.banner_pattern.enabled}
                />
              </CriterionRow>

              {/* TTL range */}
              <CriterionRow
                label="Range TTL"
                enabled={form.ttl_min.enabled}
                onToggle={(v) => {
                  updateCriterion("ttl_min", { enabled: v });
                  updateCriterion("ttl_max", { enabled: v });
                }}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} max={255}
                    value={form.ttl_min.value ?? ""}
                    onChange={(e) => updateCriterion("ttl_min", { value: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Min"
                    className="w-20 text-xs"
                    disabled={!form.ttl_min.enabled}
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    type="number" min={1} max={255}
                    value={form.ttl_max.value ?? ""}
                    onChange={(e) => updateCriterion("ttl_max", { value: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Max"
                    className="w-20 text-xs"
                    disabled={!form.ttl_max.enabled}
                  />
                </div>
              </CriterionRow>
            </div>

            {/* ── Note e opzioni ── */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Note (opzionale)</Label>
                <Textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Descrizione della regola..."
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.also_create_classification_map}
                  onCheckedChange={(v) => setForm({ ...form, also_create_classification_map: !!v })}
                />
                <Label className="text-xs">Crea anche regola di classificazione (mappa etichetta → classificazione)</Label>
              </div>
            </div>
          </div>
        </DialogScrollableArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Annulla
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salva regola
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Riga criterio con switch abilita/disabilita + campo. */
function CriterionRow({
  label, enabled, onToggle, children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 transition-opacity ${enabled ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <Label className="text-xs font-medium">{label}</Label>
      </div>
      {children}
    </div>
  );
}
