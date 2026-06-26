"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/lib/modules/registry";

interface ImportResult {
  module: string;
  ok: boolean;
  configured: boolean;
  error?: string;
}

interface Props {
  /** Se valorizzato, importa solo le entry di questo modulo (card singola). */
  presetModule?: ModuleKey;
  /** Variante compatta per la card singola. */
  size?: "sm" | "default";
}

/**
 * Import del JSON di configurazione modulo generato dall'installer.
 * Globale (tutti i moduli) o ristretto a `presetModule` (mini-import sulla card).
 * Dopo l'import fa router.refresh() così registry/launchpad/dashboard rileggono.
 */
export function ModuleJsonImport({ presetModule, size = "default" }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        toast.error("File JSON non valido");
        return;
      }
      // Restringi al modulo della card, se richiesto.
      if (presetModule) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const filtered = arr.filter(
          (e) => (e as { module?: string })?.module === presetModule,
        );
        if (filtered.length === 0) {
          toast.error(`Il JSON non contiene config per "${presetModule}"`);
          return;
        }
        payload = filtered.length === 1 ? filtered[0] : filtered;
      }

      const res = await fetch("/api/modules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; results: ImportResult[]; error?: string }
        | null;
      if (!res.ok || !data) {
        toast.error(data?.error ? String(data.error) : `Import fallito (HTTP ${res.status})`);
        return;
      }
      const okCount = data.results.filter((r) => r.ok).length;
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.warning(
          `Import parziale: ${okCount} ok, ${failed.length} falliti — ${failed
            .map((r) => `${r.module}: ${r.error}`)
            .join("; ")}`,
        );
      } else {
        toast.success(`Import completato: ${okCount} modulo/i configurato/i`);
      }
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        type="button"
        variant={presetModule ? "outline" : "default"}
        size={size}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
        {busy
          ? "Import in corso…"
          : presetModule
            ? "Importa JSON"
            : "Importa configurazione modulo (JSON)"}
      </Button>
    </>
  );
}
