"use client";

/**
 * Modale unificato di edit di un network_device.
 *
 * Usato da:
 *   - /devices/[id] (era inline, ora delega qui)
 *   - /objects/[id] (NEW v0.2.599: niente più navigation a /devices/[id])
 *
 * Estratto da src/app/(dashboard)/devices/[id]/page.tsx per ridurre l'incoerenza
 * UI segnalata dall'utente: "/objects/[id] ha tab, /devices/[id] no". Ora l'edit
 * avviene sempre inline nella scheda asset.
 *
 * Submit: PUT /api/devices/[id]
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { DeviceCredentialsTable } from "@/components/shared/device-credentials-table";
import { getClassificationLabel } from "@/lib/device-classifications";
import { vendorSubtypeFromProductProfile, type ProductProfileId } from "@/lib/device-product-profiles";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { toast } from "sonner";
import type { NetworkDevice } from "@/types";

interface EditDeviceDialogProps {
  device: NetworkDevice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (device: NetworkDevice) => void;
}

export function EditDeviceDialog({ device, open, onOpenChange, onSaved }: EditDeviceDialogProps) {
  const [editVendor, setEditVendor] = useState(device.vendor);
  const [editVendorSubtype, setEditVendorSubtype] = useState<string | null>(device.vendor_subtype ?? null);
  const [editProtocol, setEditProtocol] = useState(device.protocol);
  const [editCredentialId, setEditCredentialId] = useState<string | null>(device.credential_id != null ? String(device.credential_id) : null);
  const [editSnmpCredentialId, setEditSnmpCredentialId] = useState<string | null>(device.snmp_credential_id != null ? String(device.snmp_credential_id) : null);
  const [editScanTarget, setEditScanTarget] = useState<string | null>((device as { scan_target?: string | null }).scan_target ?? null);
  const [editProductProfile, setEditProductProfile] = useState<string | null>((device as { product_profile?: string | null }).product_profile ?? null);
  const [editClassification, setEditClassification] = useState<string>((device as { classification?: string | null }).classification ?? "");
  const [editUseForArpPoll, setEditUseForArpPoll] = useState<boolean>(() => networkDeviceUsesArpPoll(device));
  const [editSaving, setEditSaving] = useState(false);
  const [credentials, setCredentials] = useState<Array<{ id: number; name: string; credential_type: string }>>([]);

  // Re-syncronizza lo state quando cambia il device (es. dopo onSaved)
  useEffect(() => {
    setEditVendor(device.vendor);
    setEditVendorSubtype(device.vendor_subtype ?? null);
    setEditProtocol(device.protocol);
    setEditCredentialId(device.credential_id != null ? String(device.credential_id) : null);
    setEditSnmpCredentialId(device.snmp_credential_id != null ? String(device.snmp_credential_id) : null);
    setEditScanTarget((device as { scan_target?: string | null }).scan_target ?? null);
    setEditProductProfile((device as { product_profile?: string | null }).product_profile ?? null);
    setEditClassification((device as { classification?: string | null }).classification ?? "");
    setEditUseForArpPoll(networkDeviceUsesArpPoll(device));
  }, [device]);

  // Carica credenziali quando il modale si apre
  useEffect(() => {
    if (!open) return;
    fetch("/api/credentials", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ id: number; name: string; credential_type: string }>) => {
        if (Array.isArray(data)) setCredentials(data);
      })
      .catch(() => { /* modale funziona comunque */ });
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, unknown> = {
      vendor: editVendor,
      protocol: editProtocol,
      vendor_subtype: editVendorSubtype || null,
      credential_id: editCredentialId && editCredentialId !== "none" ? Number(editCredentialId) : null,
      snmp_credential_id: editSnmpCredentialId && editSnmpCredentialId !== "none" ? Number(editSnmpCredentialId) : null,
      scan_target: editScanTarget || null,
    };
    if (editProductProfile) body.product_profile = editProductProfile;
    if (editClassification) body.classification = editClassification;
    body.use_for_arp_poll = editUseForArpPoll ? 1 : 0;
    formData.forEach((val, key) => {
      if (key === "password" || key === "community_string") {
        if (val && String(val).trim()) body[key] = val;
      } else if (key === "api_url") {
        body.api_url = (val && String(val).trim()) || null;
      } else if (val && key !== "device_type") {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });

    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json() as NetworkDevice;
        toast.success("Dispositivo aggiornato");
        onOpenChange(false);
        onSaved?.(updated);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
    } finally {
      setEditSaving(false);
    }
  }

  const isHypervisorOrProxmox =
    device.device_type === "hypervisor" ||
    (device as { scan_target?: string }).scan_target === "proxmox";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/50 px-4 pt-4 pb-3">
          <DialogTitle>
            Modifica {getClassificationLabel(device.classification ?? "") || device.device_type}
          </DialogTitle>
          <CardDescription className="text-xs leading-snug">
            Identificazione, profilo marca, protocollo e credenziali. Il vendor seleziona i comandi di acquisizione.
          </CardDescription>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-3">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificazione</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input name="name" required defaultValue={device.name} placeholder="Router Core" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">IP</Label>
                  <Input
                    name="host"
                    required
                    defaultValue={device.host}
                    placeholder={isHypervisorOrProxmox ? "192.168.40.1 oppure 192.168.40.1,2,3,4,5" : "192.168.1.1"}
                  />
                </div>
                {isHypervisorOrProxmox && (
                  <>
                    <p className="text-xs text-muted-foreground col-span-2 -mt-1">
                      Scan Proxmox: su ogni IP si usano API (8006) e SSH (porta dispositivo); più nodi stesso /24 con virgole dopo il primo IP.
                    </p>
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="api_url">URL API Proxmox</Label>
                      <Input
                        id="api_url"
                        name="api_url"
                        defaultValue={device.api_url ?? ""}
                        placeholder="Opzionale: https://ip:8006 o http://ip:8006 (usa http:// se errore SSL)"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Se vuoto usa IP + porta. Per errore &quot;wrong version number&quot; prova <code className="bg-muted px-1 rounded">http://</code> invece di https.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <DeviceFormFields
              mode="edit"
              credentials={credentials}
              idPrefix="edit-device-shared"
              showIdentificazione={false}
              showProfilo={true}
              showCredenziali={false}
              classification={editClassification}
              vendor={editVendor}
              vendorSubtype={editVendorSubtype}
              protocol={editProtocol}
              scanTarget={editScanTarget}
              productProfile={editProductProfile}
              onClassificationChange={setEditClassification}
              onVendorChange={(v) => {
                setEditVendor(v as NetworkDevice["vendor"]);
                if (v !== "hp") setEditVendorSubtype(null);
              }}
              onVendorSubtypeChange={setEditVendorSubtype}
              onProtocolChange={(v) => setEditProtocol(v as NetworkDevice["protocol"])}
              onScanTargetChange={setEditScanTarget}
              onProductProfileChange={(v) => {
                setEditProductProfile(v);
                setEditVendorSubtype(vendorSubtypeFromProductProfile(v as ProductProfileId));
              }}
              useForArpPoll={editUseForArpPoll}
              onUseForArpPollChange={setEditUseForArpPoll}
              defaultUseForArpPoll={editClassification === "router" || editClassification === "firewall"}
            />

            <DeviceCredentialsTable deviceId={device.id} />

            <Button type="submit" className="w-full" disabled={editSaving}>
              {editSaving ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </form>
        </DialogScrollableArea>
      </DialogContent>
    </Dialog>
  );
}
