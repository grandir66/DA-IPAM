"use client";

/**
 * Modale unificato di promozione "host → dispositivo gestito".
 *
 * Usato da:
 *   - /hosts/[id]            (Modifica/Promuovi su scheda discovery)
 *   - /objects/[id]          (Promuovi a dispositivo da vista unificata)
 *
 * Valori iniziali: `proponiApparato` (src/lib/devices/proposta-apparato.ts),
 * la stessa proposta delle altre finestre di promozione (tappa 1, 15/10).
 *
 * Backed by POST /api/devices.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { LoadError } from "@/components/shared/load-error";
import { isMacOsHost } from "@/lib/host-platform-detect";
import { getDefaultProductProfileForVendor } from "@/lib/device-product-profiles";
import {
  proponiApparato,
  riallineaAlProtocollo,
  type CredenzialeArchivio,
  type PropostaApparato,
  type ProtocolloApparato,
} from "@/lib/devices/proposta-apparato";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "sonner";
import type { HostDetail, NetworkDevice } from "@/types";

interface PromoteHostDialogProps {
  host: HostDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamato dopo creazione device riuscita (per refresh dati scheda host) */
  onCreated?: (device: NetworkDevice) => void;
}

type PromotableDeviceType =
  | "router" | "switch" | "firewall" | "hypervisor" | "access_point" | "nas" | "server";

function inferDeviceTypeFromClassification(c: string): PromotableDeviceType {
  if (c === "firewall") return "firewall";
  if (c === "router") return "router";
  if (c === "switch") return "switch";
  if (c === "access_point") return "access_point";
  if (c === "nas" || c === "storage") return "nas";
  if (c === "hypervisor" || c === "vm") return "hypervisor";
  return "server";
}

interface DeviceFormState extends PropostaApparato {
  device_type: PromotableDeviceType;
  vendorSubtype: string | null;
}

/** Valori iniziali dalla proposta unica (tappa 1): piattaforma dal SO, credenziale e porta coerenti. */
function buildInitialForm(host: HostDetail, archivio: CredenzialeArchivio[]): DeviceFormState {
  const proposta = proponiApparato(host, archivio);
  return {
    ...proposta,
    device_type: inferDeviceTypeFromClassification(proposta.classification),
    vendorSubtype: null,
  };
}

export function PromoteHostDialog({ host, open, onOpenChange, onCreated }: PromoteHostDialogProps) {
  const [form, setForm] = useState<DeviceFormState | null>(null);
  const [creating, setCreating] = useState(false);
  const [credentialsList, setCredentialsList] = useState<CredenzialeArchivio[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // La proposta sceglie la credenziale guardandone il tipo nell'archivio: si
  // calcola quando l'archivio è arrivato. Un errore si mostra, non diventa una
  // lista vuota (che farebbe credere che non ci siano credenziali).
  const carica = useCallback(async () => {
    setLoadError(null);
    setForm(null);
    const r = await fetchJson<CredenzialeArchivio[]>("/api/credentials", { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    const archivio = Array.isArray(r.data) ? r.data : [];
    setCredentialsList(archivio);
    setForm(buildInitialForm(host, archivio));
  }, [host]);

  // Apertura (o cambio host) = archivio riletto e proposta ricalcolata
  useEffect(() => {
    if (open) void carica();
  }, [open, carica]);

  const aggiorna = useCallback((fn: (f: DeviceFormState) => DeviceFormState) => {
    setForm((f) => (f ? fn(f) : f));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form || !form.classification) return;
    setCreating(true);

    // Solo ciò che la finestra mostra: modello, seriale, firmware, sysName e
    // community stanno già sull'host e li scrive la lettura dell'apparato.
    const body: Record<string, unknown> = {
      name: form.name,
      host: host.ip,
      device_type: form.device_type,
      vendor: form.vendor,
      protocol: form.protocol,
      port: form.port,
      classification: form.classification,
      vendor_subtype: form.vendorSubtype || undefined,
      product_profile: form.productProfile || undefined,
      scan_target: form.scanTarget || undefined,
      // 0 esplicito: una spunta tolta resta tolta (assente = l'API decide da sola).
      use_for_arp_poll: form.useForArpPoll ? 1 : 0,
    };
    if (form.credentialId && form.credentialId !== "none") {
      body.credential_id = Number(form.credentialId);
    }
    if (form.snmpCredentialId && form.snmpCredentialId !== "none") {
      body.snmp_credential_id = Number(form.snmpCredentialId);
    }

    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const device = (await res.json()) as NetworkDevice;
        toast.success("Dispositivo creato");
        onOpenChange(false);
        onCreated?.(device);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore nella creazione del dispositivo");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore di rete");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>Promuovi a dispositivo gestito — {host.ip}</DialogTitle>
          <DialogDescription>
            {host.inferred_at
              ? `Pre-compilato dall'auto-rilevamento (confidence ${host.inferred_confidence ?? 0}%). Modifica se necessario.`
              : "Campi pre-compilati da dati SNMP/scan."}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          {loadError ? (
            <LoadError what="le credenziali" message={loadError} onRetry={() => void carica()} />
          ) : !form ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Caricamento credenziali…</p>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input required value={form.name} onChange={(e) => aggiorna((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">IP</Label>
                <Input value={host.ip} readOnly className="bg-muted" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tipo dispositivo</Label>
              <Select
                value={form.device_type}
                onValueChange={(v) => {
                  if (!v) return;
                  aggiorna((f) => ({ ...f, device_type: v as PromotableDeviceType }));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="router">Router</SelectItem>
                  <SelectItem value="switch">Switch</SelectItem>
                  <SelectItem value="firewall">Firewall</SelectItem>
                  <SelectItem value="hypervisor">Hypervisor</SelectItem>
                  <SelectItem value="access_point">Access Point</SelectItem>
                  <SelectItem value="nas">NAS</SelectItem>
                  <SelectItem value="server">Server</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DeviceFormFields
              mode="create"
              credentials={credentialsList}
              idPrefix="promote-host"
              showIdentificazione={false}
              showProfilo={true}
              showCredenziali={true}
              senzaCredenzialiInline
              classification={form.classification}
              vendor={form.vendor}
              vendorSubtype={form.vendorSubtype}
              protocol={form.protocol}
              scanTarget={form.scanTarget}
              productProfile={form.productProfile}
              credentialId={form.credentialId}
              snmpCredentialId={form.snmpCredentialId}
              port={form.port}
              useForArpPoll={form.useForArpPoll}
              onClassificationChange={(v) => {
                aggiorna((f) => {
                  const nextVendor =
                    isMacOsHost({
                      os_info: host.os_info,
                      inferred_os_family: host.inferred_os_family,
                      device_manufacturer: host.device_manufacturer,
                      model: host.model,
                      vendor: host.vendor,
                    }) && (v === "notebook" || v === "workstation")
                      ? "apple"
                      : f.vendor;
                  const base: DeviceFormState = {
                    ...f,
                    classification: v,
                    device_type: inferDeviceTypeFromClassification(v),
                    vendor: nextVendor,
                    productProfile: getDefaultProductProfileForVendor(nextVendor, v),
                    scanTarget: nextVendor === "apple" ? "macos" : f.scanTarget,
                  };
                  return nextVendor === "apple" && f.protocol !== "ssh"
                    ? { ...riallineaAlProtocollo(base, "ssh", credentialsList, host), device_type: base.device_type, vendorSubtype: base.vendorSubtype }
                    : base;
                });
              }}
              onVendorChange={(v) => aggiorna((f) => ({ ...f, vendor: v, vendorSubtype: v !== "hp" ? null : f.vendorSubtype }))}
              onVendorSubtypeChange={(v) => aggiorna((f) => ({ ...f, vendorSubtype: v }))}
              onProtocolChange={(v) =>
                aggiorna((f) =>
                  f.protocol === v
                    ? f
                    : { ...riallineaAlProtocollo(f, v as ProtocolloApparato, credentialsList, host), device_type: f.device_type, vendorSubtype: f.vendorSubtype }
                )
              }
              onPortChange={(p) => aggiorna((f) => ({ ...f, port: p }))}
              onScanTargetChange={(v) => aggiorna((f) => ({ ...f, scanTarget: v }))}
              onProductProfileChange={(v) => aggiorna((f) => ({ ...f, productProfile: v }))}
              onCredentialIdChange={(v) =>
                aggiorna((f) => {
                  // Porta della credenziale scelta: quella validata sull'host, poi la sua propria, poi lo standard.
                  const conCred = riallineaAlProtocollo({ ...f, credentialId: v }, f.protocol, credentialsList, host);
                  return { ...f, credentialId: conCred.credentialId, port: conCred.port };
                })
              }
              onSnmpCredentialIdChange={(v) => aggiorna((f) => ({ ...f, snmpCredentialId: v }))}
              onUseForArpPollChange={(v) => aggiorna((f) => ({ ...f, useForArpPoll: v }))}
              defaultClassification={form.classification}
              defaultVendor={form.vendor || "other"}
              defaultProtocol={form.protocol || "ssh"}
            />

            <DialogFooter className="items-center">
              {!form.classification && (
                <span className="mr-auto text-sm text-amber-800 dark:text-amber-200">Scegli la classificazione</span>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
              <Button type="submit" disabled={creating || !form.classification}>{creating ? "Creazione..." : "Crea dispositivo"}</Button>
            </DialogFooter>
          </form>
          )}
        </DialogScrollableArea>
      </DialogContent>
    </Dialog>
  );
}
