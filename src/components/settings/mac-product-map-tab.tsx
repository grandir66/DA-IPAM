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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Pencil, Filter, Database, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { ALL_CATEGORY_SLUGS, mapLegacyClassification } from "@/lib/attribution/taxonomy";
import { getClassificationLabel } from "@/lib/device-classifications";

/* ── Types ─────────────────────────────────────────────────── */

interface MacProductRow {
  id: number;
  mac_prefix: string;
  hostname_pattern: string | null;
  vendor: string;
  product_family: string | null;
  category: string | null;
  confidence: number;
  source: "seed" | "domarc" | "feedback";
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface FeedbackRow {
  id: number;
  host_id: number;
  corrected_classification: string;
  previous_classification: string | null;
  fingerprint_device_label: string | null;
  fingerprint_confidence: number | null;
  corrected_by: string | null;
  created_at: string;
  host_ip: string | null;
  host_mac: string | null;
  host_hostname: string | null;
  host_custom_name: string | null;
  host_vendor: string | null;
}

/* ── Costanti UI ───────────────────────────────────────────── */

const SOURCE_META: Record<MacProductRow["source"], { label: string; className: string }> = {
  seed: { label: "seed", className: "border-muted-foreground/30 bg-muted text-muted-foreground" },
  domarc: { label: "domarc", className: "border-primary/30 bg-primary/10 text-primary" },
  feedback: { label: "feedback", className: "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-400" },
};

const NONE_CATEGORY = "__none__";

/** Etichetta leggibile per uno slug tassonomia v2 (es. "network.access_point" → "Network › Access Point"). */
function categoryLabel(slug: string): string {
  return slug
    .split(".")
    .map((part) => part.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" › ");
}

/** Rimuove separatori e mette in maiuscolo — SOLO per la preview del prefisso nel
 *  form di promozione feedback. La normalizzazione autorevole (usata dal salvataggio
 *  server-side) è `normalizeMacHex` in kb.ts/mac-product.ts: non importabile qui
 *  perché kb.ts apre better-sqlite3 (dipendenza nativa, non bundleable lato client). */
function hexPreview(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** Guess di slug vendor per il prefill del form di promozione — solo un suggerimento,
 *  l'operatore lo rivede prima di salvare. Non è `vendorSlug()` (che vive in
 *  emitters.ts, non client-safe): niente strip suffissi societari, solo slugify. */
function guessVendorSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const emptyForm = {
  mac_prefix: "",
  hostname_pattern: "",
  vendor: "",
  product_family: "",
  category: "",
  confidence: 0.7,
  source: "domarc" as MacProductRow["source"],
  enabled: true,
  note: "",
};

/* ── Component ─────────────────────────────────────────────── */

export function MacProductMapTab() {
  const [rows, setRows] = useState<MacProductRow[]>([]);
  const [kbVersion, setKbVersion] = useState<string | null>(null);
  const [kbAvailable, setKbAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MacProductRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mac-product-map");
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data.entries) ? data.entries : []);
        setKbVersion(data.kb_version ?? null);
        setKbAvailable(!!data.kb_available);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const loadFeedback = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/classification/feedback?limit=20");
      if (res.ok) {
        const data = await res.json();
        setFeedbackRows(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    finally { setFeedbackLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  /* ── Dialog CRUD ── */

  const openDialog = (row?: MacProductRow) => {
    if (row) {
      setEditing(row);
      setForm({
        mac_prefix: row.mac_prefix,
        hostname_pattern: row.hostname_pattern ?? "",
        vendor: row.vendor,
        product_family: row.product_family ?? "",
        category: row.category ?? "",
        confidence: row.confidence,
        source: row.source,
        enabled: row.enabled === 1,
        note: row.note ?? "",
      });
    } else {
      setEditing(null);
      setForm(emptyForm);
    }
    setDialogOpen(true);
  };

  /** "Promuovi a regola" (§4.7): precompila SOLO — nessuna scrittura automatica.
   *  L'operatore rivede e conferma dal dialog di creazione, come una entry nuova. */
  const openPromoteDialog = (fb: FeedbackRow) => {
    if (!fb.host_mac) return; // il bottone è disabilitato in questo caso
    const hex = hexPreview(fb.host_mac);
    const mapped = mapLegacyClassification(fb.corrected_classification);
    const hostLabel = fb.host_hostname || fb.host_custom_name || fb.host_ip || `host #${fb.host_id}`;
    setEditing(null);
    setForm({
      ...emptyForm,
      mac_prefix: hex.slice(0, 6),
      vendor: fb.host_vendor ? guessVendorSlug(fb.host_vendor) : "",
      product_family: fb.fingerprint_device_label ?? "",
      category: mapped.category ?? "",
      confidence: 0.85,
      source: "feedback",
      note: `Promosso da correzione classification_feedback #${fb.id} (host ${hostLabel}).`,
    });
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        mac_prefix: form.mac_prefix.trim(),
        hostname_pattern: form.hostname_pattern.trim() || null,
        vendor: form.vendor.trim(),
        product_family: form.product_family.trim() || null,
        category: form.category || null,
        confidence: form.confidence,
        source: form.source,
        enabled: form.enabled ? 1 : 0,
        note: form.note.trim() || null,
      };
      const url = editing ? `/api/mac-product-map/${editing.id}` : "/api/mac-product-map";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Errore nel salvataggio");
        return;
      }
      toast.success(editing ? "Voce aggiornata" : "Voce creata");
      setDialogOpen(false);
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (row: MacProductRow) => {
    if (!confirm(`Eliminare la voce ${row.mac_prefix} (${row.vendor})?`)) return;
    try {
      const res = await fetch(`/api/mac-product-map/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Errore nell'eliminazione");
        return;
      }
      toast.success("Voce eliminata");
      load();
    } catch { toast.error("Errore di rete"); }
  };

  const handleToggle = async (row: MacProductRow, enabled: boolean) => {
    try {
      const res = await fetch(`/api/mac-product-map/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
      });
      if (!res.ok) {
        toast.error("Errore aggiornamento");
        return;
      }
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, enabled: enabled ? 1 : 0 } : r));
    } catch { toast.error("Errore aggiornamento"); }
  };

  /* ── Filtro client-side ── */

  const filterLower = filter.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (!filterLower) return true;
    return (
      r.mac_prefix.toLowerCase().includes(filterLower) ||
      r.vendor.toLowerCase().includes(filterLower) ||
      (r.product_family ?? "").toLowerCase().includes(filterLower) ||
      (r.category ?? "").toLowerCase().includes(filterLower) ||
      (r.note ?? "").toLowerCase().includes(filterLower)
    );
  });

  if (loading) return <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento…</CardContent></Card>;

  return (
    <TooltipProvider delay={150}>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Mappa MAC → linea di prodotto</CardTitle>
              </div>
              <CardDescription className="mt-1 max-w-3xl">
                Risolve vendor, famiglia prodotto e categoria per prefisso MAC (24/28/36 bit), opzionalmente
                combinato con un pattern hostname — utile quando lo stesso vendor produce famiglie diverse
                indistinguibili dal solo OUI (es. Ubiquiti: AP/switch/gateway condividono gli stessi prefissi).
                Il match è per prefisso più lungo.
              </CardDescription>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {kbAvailable ? (
                  <Badge variant="outline" className="font-mono">KB vendorizzata: v{kbVersion ?? "?"}</Badge>
                ) : (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">
                    KB vendorizzata non disponibile
                  </Badge>
                )}
                <span>{rows.length} prefissi in mappa</span>
                <span>·</span>
                <span>{rows.filter((r) => r.source === "seed").length} seed, {rows.filter((r) => r.source === "domarc").length} domarc, {rows.filter((r) => r.source === "feedback").length} feedback</span>
              </div>
            </div>
            <Button type="button" size="sm" onClick={() => openDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova voce
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-4">
              <div className="relative flex-1">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtra per prefisso MAC, vendor, prodotto, categoria…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="border rounded-md overflow-auto max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[56px]">On</TableHead>
                    <TableHead>Prefisso MAC</TableHead>
                    <TableHead>Hostname pattern</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Famiglia prodotto</TableHead>
                    <TableHead className="w-[140px]">Categoria</TableHead>
                    <TableHead className="w-[80px]">Conf.</TableHead>
                    <TableHead className="w-[90px]">Sorgente</TableHead>
                    <TableHead className="w-[88px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {filter ? "Nessun risultato per il filtro." : "Nessuna voce."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row) => (
                      <TableRow key={row.id} className={row.enabled ? "" : "opacity-50"}>
                        <TableCell>
                          <Switch checked={row.enabled === 1} onCheckedChange={(c) => handleToggle(row, c)} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.mac_prefix}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[160px] truncate" title={row.hostname_pattern ?? ""}>
                          {row.hostname_pattern ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{row.vendor}</TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate" title={row.product_family ?? ""}>
                          {row.product_family ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {row.category ? <Badge variant="outline">{categoryLabel(row.category)}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.confidence.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${SOURCE_META[row.source]?.className ?? ""}`}>
                            {SOURCE_META[row.source]?.label ?? row.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openDialog(row)} title="Modifica">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(row)}
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
            </div>
          </CardContent>
        </Card>

        {/* ═══ Loop di feedback (§4.7) ═══ */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Correzioni di classificazione recenti</CardTitle>
            </div>
            <CardDescription className="mt-1 max-w-3xl">
              Ultime correzioni manuali (<code className="text-xs bg-muted px-1 rounded">classification_feedback</code>, oggi
              scritte e mai lette altrove). &quot;Promuovi a regola&quot; precompila una nuova voce della mappa sopra con
              <code className="text-xs bg-muted px-1 rounded mx-1">source=&apos;feedback&apos;</code>
              — nessuna promozione automatica: la decisione resta all&apos;operatore, che rivede e conferma dal dialog.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Da → a</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>Da</TableHead>
                  <TableHead className="w-[140px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbackLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Caricamento…</TableCell></TableRow>
                ) : feedbackRows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessuna correzione registrata.</TableCell></TableRow>
                ) : (
                  feedbackRows.map((fb) => {
                    const resolvable = !!fb.host_mac;
                    const hostLabel = fb.host_hostname || fb.host_custom_name || fb.host_ip || `host #${fb.host_id}`;
                    const promoteButton = (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!resolvable}
                        onClick={() => openPromoteDialog(fb)}
                      >
                        <ArrowUpCircle className="h-3.5 w-3.5 mr-1.5" />
                        Promuovi a regola
                      </Button>
                    );
                    return (
                      <TableRow key={fb.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(fb.created_at).toLocaleString("it-IT")}
                        </TableCell>
                        <TableCell className="text-sm">{hostLabel}</TableCell>
                        <TableCell className="text-xs">
                          {fb.previous_classification ? getClassificationLabel(fb.previous_classification) : "—"}
                          {" → "}
                          <span className="font-medium">{getClassificationLabel(fb.corrected_classification)}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={fb.fingerprint_device_label ?? ""}>
                          {fb.fingerprint_device_label ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fb.corrected_by ?? "—"}</TableCell>
                        <TableCell>
                          {resolvable ? promoteButton : (
                            <Tooltip>
                              <TooltipTrigger render={<span className="inline-block">{promoteButton}</span>} />
                              <TooltipContent>
                                MAC non risolvibile: l&apos;host non ha un indirizzo MAC registrato.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog add/edit */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Modifica voce" : "Nuova voce MAC → prodotto"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prefisso MAC</Label>
                  <Input
                    value={form.mac_prefix}
                    onChange={(e) => setForm((f) => ({ ...f, mac_prefix: e.target.value }))}
                    placeholder="es. 00156D"
                    required
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">6, 7 o 9 cifre esadecimali (24/28/36 bit). Separatori ignorati.</p>
                </div>
                <div className="space-y-2">
                  <Label>Hostname pattern (regex, opzionale)</Label>
                  <Input
                    value={form.hostname_pattern}
                    onChange={(e) => setForm((f) => ({ ...f, hostname_pattern: e.target.value }))}
                    placeholder="es. ^ap-"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Se vuoto vale per qualunque host con questo prefisso.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vendor (slug)</Label>
                  <Input
                    value={form.vendor}
                    onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                    placeholder="es. ubiquiti"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Famiglia prodotto (opzionale)</Label>
                  <Input
                    value={form.product_family}
                    onChange={(e) => setForm((f) => ({ ...f, product_family: e.target.value }))}
                    placeholder="es. UniFi AP"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Categoria (opzionale)</Label>
                  <Select
                    value={form.category || NONE_CATEGORY}
                    onValueChange={(v) => setForm((f) => ({ ...f, category: v === NONE_CATEGORY ? "" : (v ?? f.category) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      <SelectItem value={NONE_CATEGORY}>— Nessuna —</SelectItem>
                      {ALL_CATEGORY_SLUGS.filter((c) => c !== "unknown").map((c) => (
                        <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Confidenza (0–1)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.confidence}
                    onChange={(e) => setForm((f) => ({ ...f, confidence: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Sorgente</Label>
                  <Select
                    value={form.source}
                    onValueChange={(v) => setForm((f) => ({ ...f, source: (v ?? f.source) as MacProductRow["source"] }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="domarc">domarc</SelectItem>
                      <SelectItem value="seed">seed</SelectItem>
                      <SelectItem value="feedback">feedback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 flex flex-col justify-end">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c }))}
                    />
                    <Label className="cursor-pointer">Abilitata</Label>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note (opzionale)</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Note aggiuntive"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Annulla</Button>
                <Button type="submit" disabled={saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
