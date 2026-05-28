"use client";

/**
 * Dialog gestione preset chip della pagina /discovery.
 *
 * Permette all'utente di:
 *   - Aggiungere nuovi preset (label, icona, lista classification matchate)
 *   - Modificare label / icona / classification dei preset esistenti
 *   - Rimuovere preset (anche built-in)
 *   - Ripristinare i preset di default
 *
 * Le modifiche vengono passate al parent via onSave (che gestisce persistence).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Server, Monitor, HardDrive, Router as RouterIcon, Cable, Wifi, Shield, Network,
  BatteryCharging, Phone, Printer, Camera, Cpu, Smartphone, Database, Link2,
  Boxes, Activity, Package, Plus, Trash2, ChevronDown, ChevronUp, RotateCcw,
} from "lucide-react";
import type { ClassPreset } from "@/app/(dashboard)/discovery/preset-types";
import { getClassificationLabel } from "@/lib/device-classifications";

const ICONS: Array<{ name: ClassPreset["iconName"]; icon: typeof Server }> = [
  { name: "Server", icon: Server },
  { name: "Monitor", icon: Monitor },
  { name: "HardDrive", icon: HardDrive },
  { name: "RouterIcon", icon: RouterIcon },
  { name: "Cable", icon: Cable },
  { name: "Wifi", icon: Wifi },
  { name: "Shield", icon: Shield },
  { name: "Network", icon: Network },
  { name: "BatteryCharging", icon: BatteryCharging },
  { name: "Phone", icon: Phone },
  { name: "Printer", icon: Printer },
  { name: "Camera", icon: Camera },
  { name: "Cpu", icon: Cpu },
  { name: "Smartphone", icon: Smartphone },
  { name: "Database", icon: Database },
  { name: "Link2", icon: Link2 },
  { name: "Boxes", icon: Boxes },
  { name: "Activity", icon: Activity },
  { name: "Package", icon: Package },
];

const ICON_BY_NAME = Object.fromEntries(ICONS.map((i) => [i.name, i.icon])) as Record<ClassPreset["iconName"], typeof Server>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: ClassPreset[];
  availableClassifications: readonly string[];
  /** v0.2.632: opzionale override label (per supportare custom classifications). */
  getLabel?: (slug: string) => string;
  onSave: (next: ClassPreset[]) => void;
  onReset: () => void;
}

export function PresetsDialog({ open, onOpenChange, presets, availableClassifications, getLabel, onSave, onReset }: Props) {
  const labelOf = getLabel ?? getClassificationLabel;
  const [draft, setDraft] = useState<ClassPreset[]>([]);

  // Sincronizza il draft con le props quando si apre o quando presets cambia esternamente
  useEffect(() => {
    if (open) setDraft(presets.map((p) => ({ ...p, match: [...p.match] })));
  }, [open, presets]);

  const updateAt = (idx: number, patch: Partial<ClassPreset>) => {
    setDraft((prev) => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  };

  const removeAt = (idx: number) => {
    setDraft((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      // I preset speciali sono cablati nella logica di filtro (`group:multihomed`,
      // `group:other`) — rimuoverli lascia gli host MH/unclassified senza chip,
      // cosa non desiderata. Blocco la rimozione.
      if (target.filter === "group:multihomed" || target.filter === "group:other") return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const moveAt = (idx: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const addNew = () => {
    const slug = `user:${Date.now().toString(36)}`;
    setDraft((prev) => [...prev, {
      filter: slug,
      label: "Nuovo",
      iconName: "Boxes",
      match: [],
      builtin: false,
    }]);
  };

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-7xl w-full">
        <DialogHeader className="border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Gestisci filtri rapidi</DialogTitle>
        </DialogHeader>

        <DialogScrollableArea className="px-4 py-3 max-h-[70vh]">
          <p className="text-xs text-muted-foreground mb-3">
            I filtri appaiono come chip sopra la tabella discovery. Ogni filtro definisce quali classificazioni includere.
            Speciali: <code>group:multihomed</code> mostra host con interfacce multiple, <code>group:other</code> è il catchall.
          </p>

          <div className="space-y-2 mb-3">
            {draft.map((preset, idx) => {
              const Icon = ICON_BY_NAME[preset.iconName] ?? Boxes;
              const isSpecial = preset.filter === "group:multihomed" || preset.filter === "group:other";
              // Classification già assegnate ad ALTRI preset: vanno nascoste
              // dalla lista disponibile di questo, ma restano selezionate qui
              // (se ce le ha già). Rimuoverle da un preset le rimette in pool.
              const claimedElsewhere = new Set(
                draft.flatMap((p, j) => (j === idx ? [] : p.match))
              );
              return (
                <div key={`${preset.filter}-${idx}`} className="border rounded-md p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveAt(idx, -1)}
                        title="Sposta su"
                        className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      ><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button
                        type="button"
                        disabled={idx === draft.length - 1}
                        onClick={() => moveAt(idx, 1)}
                        title="Sposta giù"
                        className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      ><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <Icon className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nome categoria</Label>
                      <Input
                        value={preset.label}
                        onChange={(e) => updateAt(idx, { label: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Es. Server, Router, AP…"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Icona</Label>
                      <select
                        value={preset.iconName}
                        onChange={(e) => updateAt(idx, { iconName: e.target.value as ClassPreset["iconName"] })}
                        className="h-8 text-xs border rounded px-2 bg-background"
                      >
                        {ICONS.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
                      </select>
                    </div>
                    {preset.builtin && <Badge variant="outline" className="text-[10px] self-end mb-1">built-in</Badge>}
                    {isSpecial && <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-300 text-amber-700 self-end mb-1">speciale</Badge>}
                    <button
                      type="button"
                      onClick={() => removeAt(idx)}
                      disabled={isSpecial}
                      title={isSpecial ? "Preset speciale: non rimovibile" : "Rimuovi"}
                      className="p-1.5 rounded text-destructive hover:bg-destructive/10 self-end mb-0.5 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    ><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {!isSpecial && (
                    <ClassificationMultiSelect
                      selected={preset.match}
                      available={availableClassifications}
                      hideFromPool={claimedElsewhere}
                      getLabel={labelOf}
                      onChange={(next) => updateAt(idx, { match: next })}
                    />
                  )}
                  {isSpecial && (
                    <p className="text-[11px] text-muted-foreground italic">
                      Questo è un preset speciale: la logica di filtro è hard-coded, non usa il match.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addNew}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nuovo filtro
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { onReset(); onOpenChange(false); }} title="Ripristina i preset di default">
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Ripristina default
            </Button>
          </div>
        </DialogScrollableArea>

        <DialogFooter className="px-4 py-3 border-t border-border/50">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={handleSave}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MultiSelectProps {
  selected: string[];
  available: readonly string[];
  /** Classification già assegnate ad altri preset: nascoste dal pool ma non
   *  forzate qui (il caller mantiene `selected` autoritativo). */
  hideFromPool?: ReadonlySet<string>;
  /** Override label (per custom classifications). */
  getLabel?: (slug: string) => string;
  onChange: (next: string[]) => void;
}

function ClassificationMultiSelect({ selected, available, hideFromPool, getLabel, onChange }: MultiSelectProps) {
  const [search, setSearch] = useState("");
  const labelOf = getLabel ?? getClassificationLabel;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter((c) => c.includes(q) || labelOf(c).toLowerCase().includes(q));
  }, [available, search, labelOf]);

  const toggle = (slug: string) => {
    if (selectedSet.has(slug)) onChange(selected.filter((s) => s !== slug));
    else onChange([...selected, slug]);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Classificazioni incluse ({selected.length})
        </Label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="cerca…"
          className="h-6 text-xs ml-auto w-32"
        />
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map((s) => (
            <Badge key={s} variant="default" className="text-[10px] gap-1 cursor-pointer" onClick={() => toggle(s)}>
              {labelOf(s) || s}
              <span className="text-primary-foreground/60">×</span>
            </Badge>
          ))}
        </div>
      )}
      <div className="border rounded max-h-[160px] overflow-y-auto p-1 grid grid-cols-4 gap-0.5">
        {filtered.filter((c) => !selectedSet.has(c) && !(hideFromPool?.has(c))).slice(0, 80).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className="text-[11px] text-left px-1.5 py-0.5 rounded hover:bg-primary/10 hover:text-primary truncate"
            title={c}
          >
            + {labelOf(c) || c}
          </button>
        ))}
      </div>
    </div>
  );
}
