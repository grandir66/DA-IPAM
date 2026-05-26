"use client";

/**
 * Cella editabile inline per tabelle dense (es. lista discovery).
 *
 * Click sulla cella → input/select. On blur o Enter → save. Esc → cancel.
 *
 * Supporta due varianti:
 *   - mode="text"   → <input type="text">
 *   - mode="select" → <select> con opzioni
 *
 * Save callback `onSave(value)` riceve la nuova stringa (può essere "" per
 * cancellare). Chi consuma decide se PUT/PATCH e che cosa renderizzare come
 * "visualizzazione" tramite la prop `display`.
 */

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

interface BaseProps {
  /** Valore corrente (stringa o null) */
  value: string | null;
  /** Callback save. Throw o reject = errore (la cella torna in edit). */
  onSave: (next: string) => Promise<void> | void;
  /** Render della cella in modalità readonly. Default: testo value o "—". */
  display?: React.ReactNode;
  /** Placeholder dell'input/select quando vuoto */
  placeholder?: string;
  /** Classe CSS del trigger cliccabile (default: cursor-pointer hover bg-muted) */
  className?: string;
  /** Disabilita l'edit (es. per riga in loading) */
  disabled?: boolean;
  /** Tooltip da mostrare hover sulla cella */
  title?: string;
}

interface TextProps extends BaseProps {
  mode?: "text";
  selectOptions?: never;
}

interface SelectProps extends BaseProps {
  mode: "select";
  selectOptions: Array<{ value: string; label: string }>;
}

type Props = TextProps | SelectProps;

export function InlineEditCell(props: Props) {
  const { value, onSave, display, placeholder, className, disabled, title } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (!editing) return;
    if (props.mode === "select") selectRef.current?.focus();
    else inputRef.current?.focus();
  }, [editing, props.mode]);

  async function commit(nextRaw: string) {
    const next = nextRaw.trim();
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // lasciamo in editing per retry; il chiamante mostra il toast
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
  }

  if (editing) {
    if (props.mode === "select") {
      return (
        <select
          ref={selectRef}
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            void commit(e.target.value);
          }}
          onBlur={() => cancel()}
          onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
          className="w-full text-xs border border-primary rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {props.selectOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(draft); }
          if (e.key === "Escape") cancel();
        }}
        className="w-full text-sm border border-primary rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={title ?? "Clicca per modificare"}
      className={`group inline-flex items-center gap-1 w-full text-left rounded px-1 py-0.5 hover:bg-muted/60 transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-text"} ${className ?? ""}`}
    >
      <span className="flex-1 min-w-0 truncate">
        {display ?? (value || <span className="text-muted-foreground text-xs">—</span>)}
      </span>
      <Pencil className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
    </button>
  );
}
