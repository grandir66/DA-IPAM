"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export interface AddableOption {
  id: number;
  label: string;
  extra?: string;
}

interface AddableSelectProps {
  value: number | null;
  onChange: (id: number | null) => void;
  options: AddableOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Etichetta dell'entità che si sta creando (es. "ubicazione", "assegnatario"). */
  entityLabel: string;
  /** Endpoint API POST. Body inviato: { name, ...extraFields }. Risposta deve essere l'oggetto creato (con .id e .name). */
  createApiUrl: string;
  /** Campi opzionali da raccogliere nel dialog di quick-create. */
  extraFields?: Array<{ key: string; label: string; placeholder?: string; type?: "text" | "email" }>;
  /** Chiamato dopo creazione riuscita per ricaricare la lista. */
  onCreated: () => void | Promise<void>;
}

/**
 * Select con opzione "+ Aggiungi ${entityLabel}" che apre un dialog di
 * quick-create. Utile per popolare al volo lookup tables (locations,
 * asset_assignees, ecc.) senza lasciare il form corrente.
 */
export function AddableSelect({
  value,
  onChange,
  options,
  placeholder = "Seleziona",
  disabled,
  entityLabel,
  createApiUrl,
  extraFields = [],
  onCreated,
}: AddableSelectProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});

  function reset() {
    setName("");
    setExtraValues({});
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Nome richiesto"); return; }
    setSaving(true);
    try {
      const body: Record<string, string | null> = { name: name.trim() };
      for (const f of extraFields) {
        const v = extraValues[f.key]?.trim();
        body[f.key] = v ? v : null;
      }
      const res = await fetch(createApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const created = await res.json() as { id: number; name: string };
        toast.success(`${entityLabel.charAt(0).toUpperCase()}${entityLabel.slice(1)} creato/a`);
        await onCreated();
        onChange(created.id);
        setOpen(false);
        reset();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore nella creazione");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="flex gap-1.5">
        <Select
          value={value != null ? String(value) : "none"}
          onValueChange={(v) => onChange(!v || v === "none" ? null : Number(v))}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1"><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Nessuno</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.label}{o.extra ? ` (${o.extra})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => { reset(); setOpen(true); }}
          disabled={disabled}
          title={`Aggiungi ${entityLabel}`}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo/a {entityLabel}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            {extraFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  type={f.type ?? "text"}
                  value={extraValues[f.key] ?? ""}
                  onChange={(e) => setExtraValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : "Crea"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
