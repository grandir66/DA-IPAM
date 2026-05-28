"use client";

/**
 * Patch Management — Dialog "Pin manuale fix" (F7 base, refinement in PR3).
 *
 * In F7 esponiamo il form minimale per fissare manualmente un fix:
 *   softwareId (numeric) + chocoId (string) + fixVersion? (string)
 * Backend: POST /api/patch/cve/[cveId]/match
 *
 * Il softwareId dovrebbe essere selezionato da una lookup
 * `software_inventory` filtrata sugli host vulnerabili. Quella select avanzata
 * arriva in PR3 — per ora chiediamo l'ID grezzo (l'admin lo legge dalla
 * pagina host o dal DB). Il submit è abilitato solo se entrambi i required
 * sono valorizzati.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PinFixDialogProps {
  open: boolean;
  onClose: () => void;
  cveId: string;
  onPinned?: () => void;
}

export function PinFixDialog({
  open,
  onClose,
  cveId,
  onPinned,
}: PinFixDialogProps) {
  const [softwareId, setSoftwareId] = useState("");
  const [chocoId, setChocoId] = useState("");
  const [fixVersion, setFixVersion] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSoftwareId("");
    setChocoId("");
    setFixVersion("");
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const sid = Number(softwareId);
    if (!Number.isFinite(sid) || sid <= 0) {
      toast.error("softwareId deve essere un numero positivo");
      return;
    }
    if (!chocoId.trim()) {
      toast.error("chocoId è obbligatorio");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/patch/cve/${encodeURIComponent(cveId)}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            softwareId: sid,
            chocoId: chocoId.trim(),
            fixVersion: fixVersion.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success("Fix pin salvato con successo");
      onPinned?.();
      reset();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore salvataggio pin";
      toast.error(msg);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pin manuale fix</DialogTitle>
          <DialogDescription>
            Forza un mapping CVE → pacchetto Chocolatey. Sovrascrive eventuali
            match automatici. La select avanzata software arriverà in PR3 —
            per ora indica l&apos;ID software (da pagina host inventory) e il
            package id Chocolatey.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pin-software-id">Software ID (numerico)</Label>
            <Input
              id="pin-software-id"
              type="number"
              inputMode="numeric"
              placeholder="es. 1234"
              value={softwareId}
              onChange={(e) => setSoftwareId(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Da <code>software_inventory.id</code>. Visibile nella pagina host
              → tab Software.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pin-choco-id">Choco package id</Label>
            <Input
              id="pin-choco-id"
              placeholder="es. firefox, googlechrome, 7zip"
              value={chocoId}
              onChange={(e) => setChocoId(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pin-fix-version">Versione fix (opzionale)</Label>
            <Input
              id="pin-fix-version"
              placeholder="es. 125.0.1 — vuoto = ultima disponibile"
              value={fixVersion}
              onChange={(e) => setFixVersion(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>
            Annulla
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salva pin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
