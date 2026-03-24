"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, RotateCcw, Monitor, Tags, Wifi, ArrowRight, Radar } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import {
  getClassificationLabel,
  DEVICE_CLASSIFICATIONS_ORDERED,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { SysObjLookupTab } from "@/components/settings/sysobj-lookup-tab";

/* ── Types ─────────────────────────────────────────────────── */

interface FingerprintMapRow {
  id: number;
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface FpRule {
  id: number;
  name: string;
  device_label: string;
  classification: string;
  priority: number;
  enabled: number;
  builtin: number;
  tcp_ports_key: string | null;
  tcp_ports_optional: string | null;
  min_key_ports: number | null;
  oid_prefix: string | null;
  sysdescr_pattern: string | null;
  hostname_pattern: string | null;
  mac_vendor_pattern: string | null;
  banner_pattern: string | null;
  ttl_min: number | null;
  ttl_max: number | null;
  note: string | null;
}

const emptyFpRuleForm = {
  name: "",
  device_label: "",
  classification: "server",
  priority: 100,
  enabled: true as boolean,
  tcp_ports_key: "",
  tcp_ports_optional: "",
  min_key_ports: "",
  oid_prefix: "",
  sysdescr_pattern: "",
  hostname_pattern: "",
  mac_vendor_pattern: "",
  banner_pattern: "",
  ttl_min: "",
  ttl_max: "",
  note: "",
};

/* ── Component ─────────────────────────────────────────────── */

export function DeviceIdentificationTab() {
  /* ── Fingerprint rules state ── */
  const [fpRules, setFpRules] = useState<FpRule[]>([]);
  const [fpRuleDialogOpen, setFpRuleDialogOpen] = useState(false);
  const [editingFpRule, setEditingFpRule] = useState<FpRule | null>(null);
  const [fpRuleForm, setFpRuleForm] = useState(emptyFpRuleForm);
  const [savingFpRule, setSavingFpRule] = useState(false);

  /* ── Classification map state ── */
  const [fpMapRows, setFpMapRows] = useState<FingerprintMapRow[]>([]);
  const [fpDialogOpen, setFpDialogOpen] = useState(false);
  const [editingFp, setEditingFp] = useState<FingerprintMapRow | null>(null);
  const [fpForm, setFpForm] = useState({
    match_kind: "contains" as "exact" | "contains",
    pattern: "",
    classification: "server",
    priority: 100,
    enabled: true,
    note: "",
  });
  const [savingFp, setSavingFp] = useState(false);

  /* ── Data loading ── */

  const loadFpRules = useCallback(() => {
    fetch("/api/fingerprint-rules")
      .then((r) => r.json())
      .then((rows: FpRule[]) => setFpRules(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const loadFpMapRows = useCallback(() => {
    fetch("/api/fingerprint-classification-map")
      .then((r) => r.json())
      .then((rows: FingerprintMapRow[]) => setFpMapRows(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFpRules();
    loadFpMapRows();
  }, [loadFpRules, loadFpMapRows]);

  /* ── Fingerprint rules handlers ── */

  function openFpRuleDialog(rule?: FpRule) {
    if (rule) {
      setEditingFpRule(rule);
      setFpRuleForm({
        name: rule.name,
        device_label: rule.device_label,
        classification: rule.classification,
        priority: rule.priority,
        enabled: rule.enabled === 1,
        tcp_ports_key: rule.tcp_ports_key ?? "",
        tcp_ports_optional: rule.tcp_ports_optional ?? "",
        min_key_ports: rule.min_key_ports != null ? String(rule.min_key_ports) : "",
        oid_prefix: rule.oid_prefix ?? "",
        sysdescr_pattern: rule.sysdescr_pattern ?? "",
        hostname_pattern: rule.hostname_pattern ?? "",
        mac_vendor_pattern: rule.mac_vendor_pattern ?? "",
        banner_pattern: rule.banner_pattern ?? "",
        ttl_min: rule.ttl_min != null ? String(rule.ttl_min) : "",
        ttl_max: rule.ttl_max != null ? String(rule.ttl_max) : "",
        note: rule.note ?? "",
      });
    } else {
      setEditingFpRule(null);
      setFpRuleForm(emptyFpRuleForm);
    }
    setFpRuleDialogOpen(true);
  }

  async function handleSaveFpRule(e: React.FormEvent) {
    e.preventDefault();
    setSavingFpRule(true);
    try {
      const body = {
        name: fpRuleForm.name.trim(),
        device_label: fpRuleForm.device_label.trim(),
        classification: fpRuleForm.classification,
        priority: fpRuleForm.priority,
        enabled: fpRuleForm.enabled,
        tcp_ports_key: fpRuleForm.tcp_ports_key.trim() || null,
        tcp_ports_optional: fpRuleForm.tcp_ports_optional.trim() || null,
        min_key_ports: fpRuleForm.min_key_ports ? parseInt(fpRuleForm.min_key_ports, 10) : null,
        oid_prefix: fpRuleForm.oid_prefix.trim() || null,
        sysdescr_pattern: fpRuleForm.sysdescr_pattern.trim() || null,
        hostname_pattern: fpRuleForm.hostname_pattern.trim() || null,
        mac_vendor_pattern: fpRuleForm.mac_vendor_pattern.trim() || null,
        banner_pattern: fpRuleForm.banner_pattern.trim() || null,
        ttl_min: fpRuleForm.ttl_min ? parseInt(fpRuleForm.ttl_min, 10) : null,
        ttl_max: fpRuleForm.ttl_max ? parseInt(fpRuleForm.ttl_max, 10) : null,
        note: fpRuleForm.note.trim() || null,
      };
      const url = editingFpRule ? `/api/fingerprint-rules/${editingFpRule.id}` : "/api/fingerprint-rules";
      const method = editingFpRule ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error || "Errore");
        return;
      }
      toast.success(editingFpRule ? "Regola aggiornata" : "Regola creata");
      setFpRuleDialogOpen(false);
      loadFpRules();
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSavingFpRule(false);
    }
  }

  async function deleteFpRule(id: number) {
    if (!confirm("Eliminare questa regola?")) return;
    const res = await fetch(`/api/fingerprint-rules/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Errore nell'eliminazione");
      return;
    }
    toast.success("Regola eliminata");
    loadFpRules();
  }

  async function toggleFpRuleEnabled(rule: FpRule, enabled: boolean) {
    await fetch(`/api/fingerprint-rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadFpRules();
  }

  async function resetBuiltinRules() {
    if (!confirm("Ripristinare tutte le regole built-in? Le regole built-in modificate verranno resettate ai valori di default.")) return;
    const res = await fetch("/api/fingerprint-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _action: "reset_builtin" }),
    });
    if (!res.ok) {
      toast.error("Errore nel ripristino");
      return;
    }
    toast.success("Regole built-in ripristinate");
    loadFpRules();
  }

  /* ── Classification map handlers ── */

  function openFpDialog(row?: FingerprintMapRow) {
    if (row) {
      setEditingFp(row);
      setFpForm({
        match_kind: row.match_kind,
        pattern: row.pattern,
        classification: row.classification,
        priority: row.priority,
        enabled: row.enabled === 1,
        note: row.note ?? "",
      });
    } else {
      setEditingFp(null);
      setFpForm({
        match_kind: "contains",
        pattern: "",
        classification: "server",
        priority: 100,
        enabled: true,
        note: "",
      });
    }
    setFpDialogOpen(true);
  }

  async function handleSaveFpMap(e: React.FormEvent) {
    e.preventDefault();
    if (!fpForm.pattern.trim()) {
      toast.error("Pattern richiesto");
      return;
    }
    setSavingFp(true);
    try {
      const payload = {
        match_kind: fpForm.match_kind,
        pattern: fpForm.pattern.trim(),
        classification: fpForm.classification,
        priority: fpForm.priority,
        enabled: fpForm.enabled,
        note: fpForm.note.trim() || null,
      };
      const method = editingFp ? "PUT" : "POST";
      const url = editingFp ? `/api/fingerprint-classification-map/${editingFp.id}` : "/api/fingerprint-classification-map";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(editingFp ? "Regola aggiornata" : "Regola creata");
        setFpDialogOpen(false);
        const updated = await fetch("/api/fingerprint-classification-map").then((r) => r.json());
        setFpMapRows(Array.isArray(updated) ? updated : []);
      } else {
        toast.error((data as { error?: string }).error || "Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSavingFp(false);
    }
  }

  async function toggleFpEnabled(row: FingerprintMapRow, enabled: boolean) {
    const res = await fetch(`/api/fingerprint-classification-map/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setFpMapRows((prev) => prev.map((r) => (r.id === row.id ? (data as FingerprintMapRow) : r)));
    } else {
      toast.error((data as { error?: string }).error || "Errore");
    }
  }

  async function deleteFpMap(id: number) {
    if (!confirm("Eliminare questa regola?")) return;
    const res = await fetch(`/api/fingerprint-classification-map/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFpMapRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Regola eliminata");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error((data as { error?: string }).error || "Errore");
    }
  }

  /* ── Pipeline steps ── */

  const pipelineSteps = [
    {
      step: 1,
      name: "Profilo vendor SNMP",
      desc: "Match OID enterprise \u2192 vendor profile (confidenza \u2265 90%)",
      href: "/settings/snmp-profiles",
      linkLabel: "Gestisci profili",
      anchor: null,
    },
    {
      step: 2,
      name: "Hostname prefix",
      desc: 'Pattern hostname admin (es. "SW-" \u2192 switch, "AP-" \u2192 access point)',
      href: null,
      linkLabel: null,
      anchor: null,
    },
    {
      step: 3,
      name: "sysObjectID Lookup",
      desc: "Match per prefisso pi\u00f9 lungo nella tabella sysObjectID \u2192 vendor/prodotto",
      href: null,
      linkLabel: "Vai alla tabella",
      anchor: "#sysobj-lookup",
    },
    {
      step: 4,
      name: "Fingerprint OID probe",
      desc: "SNMP GETNEXT su prefissi OID per confermare tipo device (regole DB)",
      href: null,
      linkLabel: "Vai alle firme",
      anchor: "#firme",
    },
    {
      step: 5,
      name: "Fingerprint snapshot",
      desc: "Mappa final_device del fingerprint \u2192 classificazione",
      href: null,
      linkLabel: "Vai alla classificazione",
      anchor: "#classificazione",
    },
    {
      step: 6,
      name: "Classificatore generico",
      desc: "Regole su sysDescr, OID, porte, hostname, MAC vendor",
      href: null,
      linkLabel: null,
      anchor: null,
    },
  ];

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* ═══ Section 1: Pipeline overview ═══ */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Pipeline identificazione SNMP</CardTitle>
          </div>
          <CardDescription>
            Come vengono classificati i dispositivi durante la scoperta rete. Ogni fase ha priorit&agrave; decrescente:
            la prima che matcha determina la classificazione.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pipelineSteps.map((s) => (
              <div key={s.step} className="flex items-start gap-3 rounded-md border p-3">
                <Badge variant="outline" className="mt-0.5 shrink-0">{s.step}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
                {s.href && (
                  <Link href={s.href} className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
                    {s.linkLabel} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {!s.href && s.anchor && (
                  <a href={s.anchor} className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
                    {s.linkLabel} <ArrowRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Section 2: Link to SNMP Vendor Profiles ═══ */}
      <Card className="bg-muted/30">
        <CardContent className="py-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Profili SNMP Vendor</p>
            <p className="text-sm text-muted-foreground">
              Gestisci i profili OID per la classificazione automatica dei dispositivi via SNMP (Synology, QNAP, MikroTik, etc.)
            </p>
          </div>
          <Link href="/settings/snmp-profiles">
            <Button variant="outline" size="sm">
              <Radar className="h-4 w-4 mr-2" />
              Gestisci profili SNMP
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* ═══ Section 3: sysObjectID Lookup ═══ */}
      <div id="sysobj-lookup">
        <SysObjLookupTab />
      </div>

      {/* ═══ Section 4: Firme riconoscimento dispositivi ═══ */}
      <div id="firme">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Firme riconoscimento dispositivi</CardTitle>
              </div>
              <CardDescription className="mt-1 max-w-3xl">
                Tabella unificata con tutte le firme di riconoscimento: porte TCP, OID SNMP, sysDescr, hostname, MAC vendor, banner HTTP/SSH e TTL.
                Le regole sono valutate in ordine di priorit&agrave; (numeri pi&ugrave; bassi prima). Ogni criterio specificato deve essere soddisfatto per il match.
                Le regole <code className="text-xs bg-muted px-1 rounded">built-in</code> possono essere modificate ma non eliminate.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={resetBuiltinRules}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset built-in
              </Button>
              <Button type="button" size="sm" onClick={() => openFpRuleDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Nuova firma
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[56px]">On</TableHead>
                    <TableHead className="w-[60px]">Pri.</TableHead>
                    <TableHead className="min-w-[140px]">Nome</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Classificazione</TableHead>
                    <TableHead>Criteri</TableHead>
                    <TableHead className="w-[88px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fpRules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Nessuna regola. Verranno create automaticamente al riavvio.
                      </TableCell>
                    </TableRow>
                  ) : (
                    fpRules.map((rule) => {
                      const criteria: string[] = [];
                      if (rule.tcp_ports_key) {
                        try {
                          const p = JSON.parse(rule.tcp_ports_key);
                          criteria.push(`TCP: ${p.join(",")}`);
                        } catch {
                          criteria.push("TCP: ?");
                        }
                      }
                      if (rule.oid_prefix) criteria.push(`OID: ${rule.oid_prefix}`);
                      if (rule.sysdescr_pattern) criteria.push(`sysDescr: /${rule.sysdescr_pattern}/`);
                      if (rule.hostname_pattern) criteria.push(`Host: /${rule.hostname_pattern}/`);
                      if (rule.mac_vendor_pattern) criteria.push(`MAC: /${rule.mac_vendor_pattern}/`);
                      if (rule.banner_pattern) criteria.push(`Banner: /${rule.banner_pattern}/`);
                      if (rule.ttl_min != null || rule.ttl_max != null) criteria.push(`TTL: ${rule.ttl_min ?? "?"}\u2013${rule.ttl_max ?? "?"}`);
                      return (
                        <TableRow key={rule.id} className={rule.enabled !== 1 ? "opacity-40" : undefined}>
                          <TableCell>
                            <Switch checked={rule.enabled === 1} onCheckedChange={(c) => toggleFpRuleEnabled(rule, c)} />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{rule.priority}</TableCell>
                          <TableCell className="font-medium text-sm">
                            {rule.name}
                            {rule.builtin === 1 && <Badge variant="outline" className="ml-1 text-[10px] py-0">built-in</Badge>}
                          </TableCell>
                          <TableCell className="text-sm">{rule.device_label}</TableCell>
                          <TableCell>
                            <span className="font-medium">{getClassificationLabel(rule.classification)}</span>
                            <span className="text-xs text-muted-foreground ml-1">({rule.classification})</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                            <div className="flex flex-wrap gap-1">
                              {criteria.map((c, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px] font-mono py-0">{c}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openFpRuleDialog(rule)} title="Modifica">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {rule.builtin !== 1 && (
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteFpRule(rule.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Dialog add/edit fingerprint rule */}
        <Dialog open={fpRuleDialogOpen} onOpenChange={setFpRuleDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-none">
            <DialogHeader>
              <DialogTitle>{editingFpRule ? "Modifica firma" : "Nuova firma dispositivo"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveFpRule} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome (univoco)</Label>
                  <Input value={fpRuleForm.name} onChange={(e) => setFpRuleForm((f) => ({ ...f, name: e.target.value }))} required placeholder="es. Proxmox VE (porte)" />
                </div>
                <div className="space-y-2">
                  <Label>Label dispositivo</Label>
                  <Input value={fpRuleForm.device_label} onChange={(e) => setFpRuleForm((f) => ({ ...f, device_label: e.target.value }))} required placeholder="es. Proxmox VE" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Classificazione</Label>
                  <Select value={fpRuleForm.classification} onValueChange={(v) => setFpRuleForm((f) => ({ ...f, classification: v ?? f.classification }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                        <SelectItem key={c} value={c}>{getClassificationLabel(c)} ({c})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priorità</Label>
                  <Input type="number" min={0} max={99999} value={fpRuleForm.priority} onChange={(e) => setFpRuleForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))} />
                </div>
                <div className="space-y-2 flex flex-col justify-end">
                  <div className="flex items-center gap-2">
                    <Switch checked={fpRuleForm.enabled as boolean} onCheckedChange={(c) => setFpRuleForm((f) => ({ ...f, enabled: c }))} />
                    <Label className="cursor-pointer">Abilitata</Label>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Criteri di riconoscimento (tutti opzionali — solo quelli compilati vengono verificati)</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Porte TCP chiave (JSON array)</Label>
                  <Input value={fpRuleForm.tcp_ports_key} onChange={(e) => setFpRuleForm((f) => ({ ...f, tcp_ports_key: e.target.value }))} placeholder='[8006, 22]' />
                </div>
                <div className="space-y-2">
                  <Label>Porte TCP opzionali (JSON array)</Label>
                  <Input value={fpRuleForm.tcp_ports_optional} onChange={(e) => setFpRuleForm((f) => ({ ...f, tcp_ports_optional: e.target.value }))} placeholder='[3128, 8007]' />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Min porte chiave</Label>
                  <Input type="number" min={0} value={fpRuleForm.min_key_ports} onChange={(e) => setFpRuleForm((f) => ({ ...f, min_key_ports: e.target.value }))} placeholder="Tutte" />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>OID prefix (sysObjectID)</Label>
                  <Input value={fpRuleForm.oid_prefix} onChange={(e) => setFpRuleForm((f) => ({ ...f, oid_prefix: e.target.value }))} placeholder="1.3.6.1.4.1.6574" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>sysDescr pattern (regex)</Label>
                  <Input value={fpRuleForm.sysdescr_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, sysdescr_pattern: e.target.value }))} placeholder="synology|diskstation" />
                </div>
                <div className="space-y-2">
                  <Label>Hostname pattern (regex)</Label>
                  <Input value={fpRuleForm.hostname_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, hostname_pattern: e.target.value }))} placeholder="^nas[-_]|^synology[-_]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>MAC vendor pattern (regex)</Label>
                  <Input value={fpRuleForm.mac_vendor_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, mac_vendor_pattern: e.target.value }))} placeholder="hikvision|hangzhou" />
                </div>
                <div className="space-y-2">
                  <Label>Banner HTTP/SSH pattern (regex)</Label>
                  <Input value={fpRuleForm.banner_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, banner_pattern: e.target.value }))} placeholder="proxmox|pve-manager" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>TTL minimo</Label>
                  <Input type="number" min={0} max={255} value={fpRuleForm.ttl_min} onChange={(e) => setFpRuleForm((f) => ({ ...f, ttl_min: e.target.value }))} placeholder="es. 65" />
                </div>
                <div className="space-y-2">
                  <Label>TTL massimo</Label>
                  <Input type="number" min={0} max={255} value={fpRuleForm.ttl_max} onChange={(e) => setFpRuleForm((f) => ({ ...f, ttl_max: e.target.value }))} placeholder="es. 128" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note (opzionale)</Label>
                <Input value={fpRuleForm.note} onChange={(e) => setFpRuleForm((f) => ({ ...f, note: e.target.value }))} placeholder="Perché esiste questa firma" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setFpRuleDialogOpen(false)}>Annulla</Button>
                <Button type="submit" disabled={savingFpRule}>{savingFpRule ? "Salvataggio\u2026" : "Salva"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ═══ Section 5: Regole classificazione fingerprint ═══ */}
      <div id="classificazione">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Tags className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Regole fingerprint &rarr; classificazione</CardTitle>
              </div>
              <CardDescription className="mt-1 max-w-3xl">
                Mappa manualmente il valore <code className="text-xs bg-muted px-1 rounded">final_device</code> del fingerprint
                (match esatto o contiene) sulla classificazione host. Le regole si applicano in ordine di priorit&agrave; (numeri pi&ugrave; bassi prima)
                e hanno priorit&agrave; sulla mappa integrata. Dopo le modifiche, usa &quot;Ricalcola rete&quot; sulla rete o un nuovo scan per aggiornare gli host.
                Solo gli amministratori possono creare o modificare le regole.
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={() => openFpDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova regola
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[72px]">Attiva</TableHead>
                  <TableHead className="w-[90px]">Priorità</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Classificazione</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[88px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fpMapRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nessuna regola personalizzata. Aggiungine una per correggere errori di assegnazione automatica.
                    </TableCell>
                  </TableRow>
                ) : (
                  fpMapRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Switch
                          checked={row.enabled === 1}
                          onCheckedChange={(c) => toggleFpEnabled(row, c)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{row.priority}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.match_kind === "exact" ? "Uguale" : "Contiene"}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm max-w-[200px] truncate" title={row.pattern}>
                        {row.pattern}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{getClassificationLabel(row.classification)}</span>
                        <span className="text-xs text-muted-foreground ml-1">({row.classification})</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={row.note ?? ""}>
                        {row.note || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openFpDialog(row)} title="Modifica">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteFpMap(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog add/edit classification rule */}
        <Dialog open={fpDialogOpen} onOpenChange={setFpDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingFp ? "Modifica regola" : "Nuova regola"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveFpMap} className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo match</Label>
                <Select
                  value={fpForm.match_kind}
                  onValueChange={(v) => setFpForm((f) => ({ ...f, match_kind: (v ?? f.match_kind) as "exact" | "contains" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">Uguale a (ignora maiuscole)</SelectItem>
                    <SelectItem value="contains">Contiene (ignora maiuscole)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pattern</Label>
                <Input
                  value={fpForm.pattern}
                  onChange={(e) => setFpForm((f) => ({ ...f, pattern: e.target.value }))}
                  placeholder='es. "QNAP" o "Ubuntu Server"'
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Classificazione</Label>
                <Select
                  value={fpForm.classification}
                  onValueChange={(v) =>
                    setFpForm((f) => ({ ...f, classification: v ?? f.classification }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                      <SelectItem key={c} value={c}>
                        {getClassificationLabel(c)} ({c})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Priorità</Label>
                  <Input
                    type="number"
                    min={0}
                    max={99999}
                    value={fpForm.priority}
                    onChange={(e) => setFpForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))}
                  />
                </div>
                <div className="space-y-2 flex flex-col justify-end">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={fpForm.enabled}
                      onCheckedChange={(c) => setFpForm((f) => ({ ...f, enabled: c }))}
                    />
                    <Label className="cursor-pointer">Abilitata</Label>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note (opzionale)</Label>
                <Input
                  value={fpForm.note}
                  onChange={(e) => setFpForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Perché esiste questa regola"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setFpDialogOpen(false)}>
                  Annulla
                </Button>
                <Button type="submit" disabled={savingFp}>
                  {savingFp ? "Salvataggio\u2026" : "Salva"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
