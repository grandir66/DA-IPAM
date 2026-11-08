"use client";

/**
 * Categoria a più host insieme dalla pagina della subnet (Riccardo, 08/11: «assegnare le
 * categorie agli oggetti in modo multiplo per evitare di doverlo fare una alla volta»).
 *
 * Salva con `PATCH /api/hosts/bulk-update`, lo stesso della «Modifica in blocco» della
 * Discovery: la categoria diventa una scelta a mano (`classification_manual = 1`) e le
 * scansioni dopo non la cambiano. Chi è già a mano si può lasciare com'è.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";

export interface HostPerCategoria {
  id: number;
  classification: string | null;
  classification_manual?: number;
}

/** Quanti host per categoria di oggi, in ordine di numero: «7 senza categoria · 3 Workstation». */
export function riassuntoCategorie(hosts: readonly HostPerCategoria[]): string {
  const conta = new Map<string, number>();
  for (const h of hosts) {
    const k = h.classification || "";
    conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  return [...conta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k ? getClassificationLabel(k) : "senza categoria"}`)
    .join(" · ");
}

/** Gli host a cui si scrive: quelli già a mano solo se lo si chiede. */
export function hostDaScrivere(hosts: readonly HostPerCategoria[], ancheAMano: boolean): number[] {
  return hosts.filter((h) => ancheAMano || h.classification_manual !== 1).map((h) => h.id);
}

export function CategoriaBloccoDialog({
  hosts,
  open,
  onOpenChange,
  onSalvato,
}: {
  hosts: HostPerCategoria[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSalvato: () => void;
}) {
  const [categoria, setCategoria] = useState("");
  const [ancheAMano, setAncheAMano] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const aMano = useMemo(() => hosts.filter((h) => h.classification_manual === 1).length, [hosts]);
  const ids = useMemo(() => hostDaScrivere(hosts, ancheAMano), [hosts, ancheAMano]);
  const opzioni = useMemo(() => sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED), []);

  async function applica() {
    if (!categoria) {
      toast.error("Scegli una categoria");
      return;
    }
    if (ids.length === 0) {
      toast.info("Sono tutti già messi a mano: spunta la casella per cambiarli");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/hosts/bulk-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: ids, classification: categoria }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Salvataggio non riuscito");
        return;
      }
      toast.success(`${getClassificationLabel(categoria)} su ${ids.length} host`);
      onOpenChange(false);
      onSalvato();
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Categoria per {hosts.length} host</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-[13px]">
          <select
            aria-label="Categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Scegli la categoria…</option>
            {opzioni.map((c) => (
              <option key={c} value={c}>{getClassificationLabel(c)}</option>
            ))}
          </select>
          <p className="text-muted-foreground">Oggi: {riassuntoCategorie(hosts)}</p>
          {aMano > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox id="categoria-anche-a-mano" checked={ancheAMano} onCheckedChange={(v) => setAncheAMano(v === true)} />
              <Label htmlFor="categoria-anche-a-mano" className="text-[13px] font-normal">
                Cambia anche {aMano === 1 ? "quello già messo" : `i ${aMano} già messi`} a mano
              </Label>
            </div>
          )}
          <p className="rounded-md border border-[#C9A800] bg-[#FFD400] px-2.5 py-2 text-[#0D2537]">
            ▲ Diventa una scelta a mano: le scansioni dopo non la cambiano più.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Annulla</Button>
            <Button onClick={() => void applica()} disabled={salvando}>
              Applica a {ids.length}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
