"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  Download,
  Upload,
  RotateCcw,
  Pencil,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  X,
  FolderOpen,
  RefreshCw,
  FolderUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  getClassificationLabel,
  DEVICE_CLASSIFICATIONS_ORDERED,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import Link from "next/link";

interface SnmpProfile {
  id: number;
  profile_id: string;
  name: string;
  category: string;
  enterprise_oid_prefixes: string;
  sysdescr_pattern: string | null;
  fields: string;
  /** Presente con ?merged=1: campi dopo merge file categories/ + devices/ */
  fields_merged?: string;
  confidence: number;
  enabled: number;
  builtin: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface OidLibraryFileRow {
  kind: "common" | "category" | "device";
  name: string;
  path: string;
  category?: string;
  profile_id?: string;
  fieldCount?: number;
}

interface OidLibraryResponse {
  revision: string;
  common: unknown;
  files: OidLibraryFileRow[];
  root: string;
}

interface FieldEntry {
  key: string;
  oids: string[];
}

interface OidPrefixEntry {
  value: string;
}

interface ProfileFormData {
  profile_id: string;
  name: string;
  category: string;
  oidPrefixes: OidPrefixEntry[];
  sysdescr_pattern: string;
  fieldEntries: FieldEntry[];
  confidence: number;
  enabled: boolean;
  note: string;
}

const STANDARD_FIELD_NAMES = [
  { value: "model", label: "Modello" },
  { value: "serial", label: "Seriale" },
  { value: "firmware", label: "Firmware" },
  { value: "os", label: "Sistema Operativo" },
  { value: "manufacturer", label: "Produttore" },
  { value: "partNumber", label: "Part Number" },
  { value: "cpuUsage", label: "Utilizzo CPU" },
  { value: "memUsage", label: "Utilizzo Memoria" },
  { value: "temperature", label: "Temperatura" },
  { value: "systemStatus", label: "Stato Sistema" },
  { value: "uptime", label: "Uptime" },
];

const initialFormData: ProfileFormData = {
  profile_id: "",
  name: "",
  category: "server",
  oidPrefixes: [{ value: "" }],
  sysdescr_pattern: "",
  fieldEntries: [],
  confidence: 0.9,
  enabled: true,
  note: "",
};

function parseFieldsToEntries(fieldsJson: string): FieldEntry[] {
  try {
    const obj = JSON.parse(fieldsJson);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      oids: Array.isArray(value) ? value : [value as string],
    }));
  } catch {
    return [];
  }
}

function parseOidPrefixes(json: string): OidPrefixEntry[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((v) => ({ value: v }));
    }
  } catch { /* ignore */ }
  return [{ value: "" }];
}

function entriesToFieldsJson(entries: FieldEntry[]): string {
  const obj: Record<string, string | string[]> = {};
  for (const e of entries) {
    if (e.key.trim() && e.oids.some((o) => o.trim())) {
      const validOids = e.oids.filter((o) => o.trim());
      obj[e.key.trim()] = validOids.length === 1 ? validOids[0] : validOids;
    }
  }
  return JSON.stringify(obj);
}

function oidPrefixesToJson(prefixes: OidPrefixEntry[]): string {
  const valid = prefixes.map((p) => p.value.trim()).filter(Boolean);
  return JSON.stringify(valid);
}

export default function SnmpProfilesPage() {
  const [profiles, setProfiles] = useState<SnmpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showBuiltin, setShowBuiltin] = useState(true);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<number>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SnmpProfile | null>(null);
  const [formData, setFormData] = useState<ProfileFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [importing, setImporting] = useState(false);

  const [copied, setCopied] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [oidLibrary, setOidLibrary] = useState<OidLibraryResponse | null>(null);
  const [oidLibraryLoading, setOidLibraryLoading] = useState(true);
  const [exportingToFiles, setExportingToFiles] = useState(false);

  const fetchOidLibrary = useCallback(async () => {
    setOidLibraryLoading(true);
    try {
      const res = await fetch("/api/snmp-profiles/oid-library");
      if (!res.ok) throw new Error("Errore libreria OID");
      const data = await res.json();
      setOidLibrary(data);
    } catch {
      setOidLibrary(null);
    } finally {
      setOidLibraryLoading(false);
    }
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/snmp-profiles?merged=1");
      if (!res.ok) throw new Error("Errore caricamento profili");
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch {
      toast.error("Impossibile caricare i profili SNMP");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSnmpData = useCallback(() => {
    setLoading(true);
    void fetchProfiles();
    void fetchOidLibrary();
  }, [fetchProfiles, fetchOidLibrary]);

  useEffect(() => {
    fetchProfiles();
    fetchOidLibrary();
  }, [fetchProfiles, fetchOidLibrary]);

  const toggleExpanded = (id: number) => {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleEnabled = async (profile: SnmpProfile) => {
    try {
      const res = await fetch(`/api/snmp-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !profile.enabled }),
      });
      if (!res.ok) throw new Error("Errore aggiornamento");
      toast.success(`Profilo ${profile.enabled ? "disabilitato" : "abilitato"}`);
      fetchProfiles();
    } catch {
      toast.error("Errore aggiornamento stato");
    }
  };

  const handleDelete = async (profile: SnmpProfile) => {
    if (!confirm(`Eliminare il profilo "${profile.name}"?`)) return;
    try {
      const res = await fetch(`/api/snmp-profiles/${profile.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore eliminazione");
      }
      toast.success("Profilo eliminato");
      fetchProfiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore eliminazione");
    }
  };

  const handleOpenEdit = (profile: SnmpProfile) => {
    setEditingProfile(profile);
    setFormData({
      profile_id: profile.profile_id,
      name: profile.name,
      category: profile.category,
      oidPrefixes: parseOidPrefixes(profile.enterprise_oid_prefixes),
      sysdescr_pattern: profile.sysdescr_pattern || "",
      fieldEntries: parseFieldsToEntries(profile.fields),
      confidence: profile.confidence,
      enabled: profile.enabled === 1,
      note: profile.note || "",
    });
    setDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingProfile(null);
    setFormData(initialFormData);
    setDialogOpen(true);
  };

  const handleAddOidPrefix = () => {
    setFormData((f) => ({ ...f, oidPrefixes: [...f.oidPrefixes, { value: "" }] }));
  };

  const handleRemoveOidPrefix = (index: number) => {
    setFormData((f) => ({
      ...f,
      oidPrefixes: f.oidPrefixes.filter((_, i) => i !== index),
    }));
  };

  const handleOidPrefixChange = (index: number, value: string) => {
    setFormData((f) => ({
      ...f,
      oidPrefixes: f.oidPrefixes.map((p, i) => (i === index ? { value } : p)),
    }));
  };

  const handleAddField = () => {
    setFormData((f) => ({
      ...f,
      fieldEntries: [...f.fieldEntries, { key: "", oids: [""] }],
    }));
  };

  const handleRemoveField = (index: number) => {
    setFormData((f) => ({
      ...f,
      fieldEntries: f.fieldEntries.filter((_, i) => i !== index),
    }));
  };

  const handleFieldKeyChange = (index: number, key: string) => {
    setFormData((f) => ({
      ...f,
      fieldEntries: f.fieldEntries.map((e, i) => (i === index ? { ...e, key } : e)),
    }));
  };

  const handleFieldOidChange = (fieldIndex: number, oidIndex: number, value: string) => {
    setFormData((f) => ({
      ...f,
      fieldEntries: f.fieldEntries.map((e, i) =>
        i === fieldIndex
          ? { ...e, oids: e.oids.map((o, j) => (j === oidIndex ? value : o)) }
          : e
      ),
    }));
  };

  const handleAddFieldOid = (fieldIndex: number) => {
    setFormData((f) => ({
      ...f,
      fieldEntries: f.fieldEntries.map((e, i) =>
        i === fieldIndex ? { ...e, oids: [...e.oids, ""] } : e
      ),
    }));
  };

  const handleRemoveFieldOid = (fieldIndex: number, oidIndex: number) => {
    setFormData((f) => ({
      ...f,
      fieldEntries: f.fieldEntries.map((e, i) =>
        i === fieldIndex ? { ...e, oids: e.oids.filter((_, j) => j !== oidIndex) } : e
      ),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const payload = {
      profile_id: formData.profile_id,
      name: formData.name,
      category: formData.category,
      enterprise_oid_prefixes: JSON.parse(oidPrefixesToJson(formData.oidPrefixes)),
      sysdescr_pattern: formData.sysdescr_pattern || null,
      fields: JSON.parse(entriesToFieldsJson(formData.fieldEntries)),
      confidence: formData.confidence,
      enabled: formData.enabled ? 1 : 0,
      note: formData.note || null,
    };

    try {
      let res: Response;
      if (editingProfile) {
        res = await fetch(`/api/snmp-profiles/${editingProfile.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/snmp-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore salvataggio");
      }

      toast.success(editingProfile ? "Profilo aggiornato" : "Profilo creato");
      setDialogOpen(false);
      fetchProfiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore salvataggio");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/snmp-profiles?action=export");
      if (!res.ok) throw new Error("Errore export");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.profiles, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snmp-profiles-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Profili esportati");
    } catch {
      toast.error("Errore esportazione");
    }
  };

  const handleExportDbToStructuredFiles = async () => {
    setExportingToFiles(true);
    try {
      const res = await fetch("/api/snmp-profiles?action=export-to-files", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore esportazione");
      toast.success(data.message ?? `Cartella: ${data.rootRelative}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore esportazione file");
    } finally {
      setExportingToFiles(false);
    }
  };

  const handleImport = async () => {
    if (!importJson.trim()) {
      toast.error("Inserisci il JSON da importare");
      return;
    }

    let importProfiles: unknown[];
    try {
      importProfiles = JSON.parse(importJson);
      if (!Array.isArray(importProfiles)) {
        throw new Error("Il JSON deve essere un array di profili");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "JSON non valido");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/snmp-profiles?action=import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: importProfiles, replaceExisting: replaceOnImport }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore importazione");

      toast.success(`Importati: ${data.imported}, Saltati: ${data.skipped}`);
      if (data.errors?.length > 0) {
        toast.warning(`Errori: ${data.errors.length}`);
      }
      setImportDialogOpen(false);
      setImportJson("");
      fetchProfiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore importazione");
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setImportJson(content);
    };
    reader.readAsText(file);
  };

  const handleResetBuiltin = async () => {
    if (
      !confirm(
        "Ripristinare tutti i profili builtin ai valori predefiniti del programma? Le modifiche manuali ai profili builtin andranno perse. I profili personalizzati (non builtin) non verranno toccati."
      )
    )
      return;
    try {
      const res = await fetch("/api/snmp-profiles?action=reset-builtin", { method: "POST" });
      if (!res.ok) throw new Error("Errore reset");
      toast.success("Profili builtin ripristinati");
      fetchProfiles();
    } catch {
      toast.error("Errore ripristino profili builtin");
    }
  };

  const copyToClipboard = (profileId: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(profileId);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredProfiles = profiles.filter((p) => {
    if (!showBuiltin && p.builtin === 1) return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        p.profile_id.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s) ||
        p.enterprise_oid_prefixes.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const categories = [...new Set(profiles.map((p) => p.category))].sort();

  const getFieldLabel = (key: string): string => {
    const found = STANDARD_FIELD_NAMES.find((f) => f.value === key);
    return found ? found.label : key;
  };

  const renderOidFieldRows = (obj: Record<string, string | string[]>) =>
    Object.entries(obj).map(([key, value]) => (
      <TableRow key={key}>
        <TableCell className="font-medium">
          {getFieldLabel(key)}
          <span className="text-xs text-muted-foreground ml-1">({key})</span>
        </TableCell>
        <TableCell className="font-mono text-xs">
          {Array.isArray(value) ? (
            <div className="space-y-1">
              {value.map((v, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  {v}
                </div>
              ))}
            </div>
          ) : (
            value
          )}
        </TableCell>
      </TableRow>
    ));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Impostazioni
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Profili SNMP Vendor</h1>
          <p className="text-muted-foreground text-sm">
            Gestisci i profili OID per la classificazione automatica dei dispositivi via SNMP
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
                Libreria OID (file)
              </CardTitle>
              <CardDescription>
                Cartella <code className="text-xs bg-muted px-1 rounded">config/snmp-oid-library/</code>:{" "}
                <strong>common.json</strong> per OID fondamentali di riferimento,{" "}
                <strong>categories/&lt;tipo&gt;.json</strong> per OID condivisi per classificazione,{" "}
                <strong>devices/&lt;profile_id&gt;.json</strong> per elenchi lunghi legati al profilo. Nuovi file
                compaiono automaticamente nell&apos;elenco sotto.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => refreshSnmpData()} disabled={loading || oidLibraryLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${oidLibraryLoading ? "animate-spin" : ""}`} />
              Aggiorna elenco
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {oidLibraryLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento libreria…</p>
          ) : oidLibrary && oidLibrary.files.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Revisione file: <span className="font-mono">{oidLibrary.revision}</span>
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Tipo</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="w-[100px]">Dettaglio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {oidLibrary.files.map((f) => (
                    <TableRow key={`${f.kind}-${f.path}`}>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {f.kind === "common" ? "comuni" : f.kind === "category" ? "categoria" : "dispositivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{f.path}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.kind === "device" && f.fieldCount != null ? `${f.fieldCount} campi` : f.kind === "category" ? f.category : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Leggi <code className="bg-muted px-1 rounded">config/snmp-oid-library/README.md</code> nel repository per
                formato JSON e ordine di merge.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nessun file in <code className="text-xs bg-muted px-1 rounded">config/snmp-oid-library/</code> oppure cartella assente sul server.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Profili ({filteredProfiles.length})</CardTitle>
              <CardDescription>
                Ogni profilo definisce OID enterprise e campi per identificare e interrogare dispositivi specifici
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1" />
                Esporta JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportDbToStructuredFiles}
                disabled={exportingToFiles}
                title="Crea sotto data/ una cartella snmp-oid-export-*/ con devices/, categories/, profiles_complete/ e manifest.json"
              >
                <FolderUp className={`h-4 w-4 mr-1 ${exportingToFiles ? "opacity-50" : ""}`} />
                {exportingToFiles ? "Esportazione…" : "Esporta in cartelle"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />
                Importa
              </Button>
              <Button variant="outline" size="sm" onClick={handleResetBuiltin}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset Builtin
              </Button>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger render={<Button size="sm"><Plus className="h-4 w-4 mr-1" />Nuovo profilo</Button>} onClick={handleOpenCreate} />
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-none">
                  <DialogHeader>
                    <DialogTitle>
                      {editingProfile
                        ? `Modifica profilo: ${editingProfile.name}${editingProfile.builtin === 1 ? " (builtin)" : ""}`
                        : "Nuovo profilo SNMP"}
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-6 mt-4">
                    {/* Base info */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>ID Profilo *</Label>
                        <Input
                          value={formData.profile_id}
                          onChange={(e) => setFormData((f) => ({ ...f, profile_id: e.target.value }))}
                          placeholder="es. synology_dsm"
                          pattern="^[a-z0-9_-]+$"
                          required
                          disabled={!!editingProfile}
                        />
                        <p className="text-xs text-muted-foreground mt-1">Solo a-z, 0-9, _, -</p>
                      </div>
                      <div>
                        <Label>Nome *</Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                          placeholder="es. Synology DSM"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Categoria *</Label>
                        <Select
                          value={formData.category}
                          onValueChange={(v) => v && setFormData((f) => ({ ...f, category: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                              <SelectItem key={c} value={c}>
                                {getClassificationLabel(c)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Confidenza (0-1)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={formData.confidence}
                          onChange={(e) => setFormData((f) => ({ ...f, confidence: parseFloat(e.target.value) || 0.9 }))}
                        />
                      </div>
                    </div>

                    {/* OID Prefixes */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Prefissi OID Enterprise</Label>
                        <Button type="button" variant="outline" size="sm" onClick={handleAddOidPrefix}>
                          <Plus className="h-3 w-3 mr-1" />
                          Aggiungi OID
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        OID che identificano questo vendor (es. 1.3.6.1.4.1.6574 per Synology). Puoi aggiungere più prefissi per varianti prodotto.
                      </p>
                      <div className="space-y-2">
                        {formData.oidPrefixes.map((prefix, i) => (
                          <div key={i} className="flex gap-2">
                            <Input
                              value={prefix.value}
                              onChange={(e) => handleOidPrefixChange(i, e.target.value)}
                              placeholder="1.3.6.1.4.1.XXXXX"
                              className="font-mono text-sm"
                            />
                            {formData.oidPrefixes.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveOidPrefix(i)}
                                className="text-destructive hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* sysDescr pattern */}
                    <div>
                      <Label>Pattern sysDescr (regex, opzionale)</Label>
                      <Input
                        value={formData.sysdescr_pattern}
                        onChange={(e) => setFormData((f) => ({ ...f, sysdescr_pattern: e.target.value }))}
                        placeholder="es. synology|diskstation"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Regex per match su sysDescr (case-insensitive). Usato come fallback se nessun OID corrisponde.
                      </p>
                    </div>

                    {/* Fields (structured editor) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Campi OID</Label>
                        <Button type="button" variant="outline" size="sm" onClick={handleAddField}>
                          <Plus className="h-3 w-3 mr-1" />
                          Aggiungi Campo
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Definisci quali OID interrogare per ottenere informazioni specifiche. Puoi aggiungere più OID alternativi per lo stesso campo.
                      </p>

                      {formData.fieldEntries.length === 0 ? (
                        <div className="border rounded-lg p-4 text-center text-muted-foreground text-sm">
                          Nessun campo definito. Clicca &quot;Aggiungi Campo&quot; per iniziare.
                        </div>
                      ) : (
                        <div className="border rounded-lg divide-y">
                          {formData.fieldEntries.map((field, fi) => (
                            <div key={fi} className="p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <Select
                                  value={STANDARD_FIELD_NAMES.some((f) => f.value === field.key) ? field.key : "__custom__"}
                                  onValueChange={(v) => {
                                    if (v && v !== "__custom__") {
                                      handleFieldKeyChange(fi, v);
                                    }
                                  }}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Seleziona campo" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STANDARD_FIELD_NAMES.map((f) => (
                                      <SelectItem key={f.value} value={f.value}>
                                        {f.label}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="__custom__">Personalizzato...</SelectItem>
                                  </SelectContent>
                                </Select>
                                {(!STANDARD_FIELD_NAMES.some((f) => f.value === field.key) || field.key === "") && (
                                  <Input
                                    value={field.key}
                                    onChange={(e) => handleFieldKeyChange(fi, e.target.value)}
                                    placeholder="Nome campo personalizzato"
                                    className="flex-1"
                                  />
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveField(fi)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="pl-4 space-y-1">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>OID da interrogare:</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleAddFieldOid(fi)}
                                    className="h-6 px-2 text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Variante
                                  </Button>
                                </div>
                                {field.oids.map((oid, oi) => (
                                  <div key={oi} className="flex gap-2">
                                    <Input
                                      value={oid}
                                      onChange={(e) => handleFieldOidChange(fi, oi, e.target.value)}
                                      placeholder="1.3.6.1.4.1.XXXXX.X.X.X.0"
                                      className="font-mono text-sm"
                                    />
                                    {field.oids.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveFieldOid(fi, oi)}
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Note */}
                    <div>
                      <Label>Note</Label>
                      <Textarea
                        value={formData.note}
                        onChange={(e) => setFormData((f) => ({ ...f, note: e.target.value }))}
                        placeholder="Note opzionali..."
                        rows={2}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.enabled}
                        onCheckedChange={(checked) => setFormData((f) => ({ ...f, enabled: checked }))}
                      />
                      <Label>Abilitato</Label>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                        Annulla
                      </Button>
                      <Button type="submit" disabled={submitting}>
                        {submitting ? "Salvataggio..." : editingProfile ? "Aggiorna" : "Crea"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per ID, nome o OID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {getClassificationLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch checked={showBuiltin} onCheckedChange={setShowBuiltin} />
              <Label className="text-sm">Mostra builtin</Label>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Caricamento...</div>
          ) : filteredProfiles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Nessun profilo trovato</div>
          ) : (
            <div className="space-y-2">
              {filteredProfiles.map((profile) => {
                let oids: string[] = [];
                try { oids = JSON.parse(profile.enterprise_oid_prefixes); } catch { /* ignore */ }

                let fields: Record<string, string | string[]> = {};
                try { fields = JSON.parse(profile.fields); } catch { /* ignore */ }

                let mergedFieldsRuntime: Record<string, string | string[]> = {};
                if (profile.fields_merged) {
                  try {
                    mergedFieldsRuntime = JSON.parse(profile.fields_merged) as Record<string, string | string[]>;
                  } catch {
                    /* ignore */
                  }
                }
                const runtimeFieldCount = Object.keys(mergedFieldsRuntime).length;
                const hasDeviceOidFile = oidLibrary?.files.some(
                  (f) => f.kind === "device" && f.profile_id === profile.profile_id
                );

                const isExpanded = expandedProfiles.has(profile.id);
                const fieldCount = Object.keys(fields).length;

                return (
                  <Collapsible key={profile.id} open={isExpanded} onOpenChange={() => toggleExpanded(profile.id)}>
                    <div className={`border rounded-lg ${profile.enabled === 0 ? "opacity-50" : ""}`}>
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
                          <div className="flex-shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={profile.enabled === 1}
                              onCheckedChange={() => handleToggleEnabled(profile)}
                            />
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{profile.name}</span>
                              {profile.builtin === 1 && (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">builtin</Badge>
                              )}
                              {hasDeviceOidFile && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0" title="Esiste devices/{profile.profile_id}.json">
                                  OID file
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              {profile.profile_id}
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            <Badge variant="outline">{getClassificationLabel(profile.category)}</Badge>
                          </div>
                          <div className="flex-shrink-0 text-xs text-muted-foreground">
                            {oids.length > 0 && <span className="mr-2">{oids.length} OID</span>}
                            {runtimeFieldCount > 0 ? (
                              <span title="Campi effettivi a runtime (con file libreria)">{runtimeFieldCount} campi</span>
                            ) : fieldCount > 0 ? (
                              <span>{fieldCount} campi</span>
                            ) : null}
                          </div>
                          <div className="flex-shrink-0 font-mono text-sm">
                            {(profile.confidence * 100).toFixed(0)}%
                          </div>
                          <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(profile.id, JSON.stringify({
                                profile_id: profile.profile_id,
                                name: profile.name,
                                category: profile.category,
                                enterprise_oid_prefixes: oids,
                                sysdescr_pattern: profile.sysdescr_pattern,
                                fields,
                                confidence: profile.confidence,
                                note: profile.note,
                              }, null, 2))}
                              title="Copia JSON"
                            >
                              {copied === profile.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEdit(profile)}
                              title="Modifica"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {profile.builtin === 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(profile)}
                                title="Elimina"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="border-t px-4 py-3 bg-muted/30 space-y-4">
                          {/* OID Prefixes */}
                          <div>
                            <h4 className="text-sm font-medium mb-2">Prefissi OID Enterprise</h4>
                            {oids.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Nessun prefisso OID (usa solo sysDescr)</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {oids.map((oid, i) => (
                                  <Badge key={i} variant="secondary" className="font-mono text-xs">
                                    {oid}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* sysDescr Pattern */}
                          {profile.sysdescr_pattern && (
                            <div>
                              <h4 className="text-sm font-medium mb-1">Pattern sysDescr</h4>
                              <code className="text-xs bg-muted px-2 py-1 rounded">/{profile.sysdescr_pattern}/i</code>
                            </div>
                          )}

                          {/* Campi OID: database vs runtime */}
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-sm font-medium mb-2">Campi salvati nel database ({fieldCount})</h4>
                              {fieldCount === 0 ? (
                                <p className="text-sm text-muted-foreground">Nessun campo definito nel DB</p>
                              ) : (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-[150px]">Campo</TableHead>
                                      <TableHead>OID</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>{renderOidFieldRows(fields)}</TableBody>
                                </Table>
                              )}
                            </div>
                            {profile.fields_merged && runtimeFieldCount > 0 && (
                              <div className="border-t border-border/60 pt-4">
                                <h4 className="text-sm font-medium mb-1">
                                  OID effettivi a runtime ({runtimeFieldCount})
                                </h4>
                                <p className="text-xs text-muted-foreground mb-2">
                                  Include merge da <code className="bg-muted px-1 rounded">categories/&lt;tipo&gt;.json</code> e{" "}
                                  <code className="bg-muted px-1 rounded">devices/&lt;profile_id&gt;.json</code> (le chiavi dei file
                                  sovrascrivono omonime del database).
                                </p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-[150px]">Campo</TableHead>
                                      <TableHead>OID</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>{renderOidFieldRows(mergedFieldsRuntime)}</TableBody>
                                </Table>
                              </div>
                            )}
                          </div>

                          {/* Note */}
                          {profile.note && (
                            <div>
                              <h4 className="text-sm font-medium mb-1">Note</h4>
                              <p className="text-sm text-muted-foreground">{profile.note}</p>
                            </div>
                          )}

                          {profile.builtin === 1 && (
                            <div className="pt-2 border-t">
                              <p className="text-xs text-muted-foreground">
                                Profilo <strong>builtin</strong>: modificabile qui sopra con l&apos;icona matita. &quot;Reset Builtin&quot; ripristina tutti i default del programma (perde le tue modifiche ai builtin).
                              </p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importa profili SNMP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label>JSON profili</Label>
              <Textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='[{"profile_id": "...", "name": "...", ...}]'
                rows={12}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                Carica file
              </Button>
              <div className="flex items-center gap-2">
                <Switch checked={replaceOnImport} onCheckedChange={setReplaceOnImport} />
                <Label className="text-sm">Sovrascrivi profili esistenti (non builtin)</Label>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
              <AlertCircle className="h-4 w-4 mt-0.5 text-yellow-600" />
              <div className="text-sm text-muted-foreground">
                L&apos;import non sovrascrive i profili builtin: modificali dalla lista oppure usa &quot;Reset Builtin&quot; per ripristinare i default del programma.
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                Annulla
              </Button>
              <Button onClick={handleImport} disabled={importing || !importJson.trim()}>
                {importing ? "Importazione..." : "Importa"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
