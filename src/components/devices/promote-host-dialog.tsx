"use client";

/**
 * Modale unificato di promozione "host → dispositivo gestito".
 *
 * Usato da:
 *   - /hosts/[id]            (Modifica/Promuovi su scheda discovery)
 *   - /objects/[id]          (Promuovi a dispositivo da vista unificata)
 *
 * Pre-fill dei campi:
 *   1. host.inferred_* (auto-classify server-side, F1) — priorità massima
 *   2. snmp_data parsed (sysName/model/serialNumber/firmware/community)
 *   3. host fields legacy (custom_name, device_manufacturer, classification)
 *
 * Backed by POST /api/devices.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { inferVendorFromManufacturer } from "@/lib/vendor-inference";
import { toast } from "sonner";
import type { HostDetail, HostSnmpData, NetworkDevice } from "@/types";

interface PromoteHostDialogProps {
  host: HostDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamato dopo creazione device riuscita (per refresh dati scheda host) */
  onCreated?: (device: NetworkDevice) => void;
}

function inferProtocolFromSnmp(snmp: HostSnmpData | null): string {
  return snmp ? "snmp_v2" : "ssh";
}

function inferDeviceTypeFromClassification(c: string): "router" | "switch" | "hypervisor" {
  if (c === "router" || c === "firewall") return "router";
  if (c === "switch") return "switch";
  return "hypervisor";
}

interface DeviceFormState {
  name: string;
  vendor: string;
  protocol: string;
  device_type: "router" | "switch" | "hypervisor";
  classification: string;
  port: number;
  model: string;
  serial_number: string;
  firmware: string;
  sysname: string;
  sysdescr: string;
  community_string: string;
  vendorSubtype: string | null;
  productProfile: string | null;
  scanTarget: string | null;
  credentialId: string | null;
  snmpCredentialId: string | null;
  useForArpPoll: boolean;
}

function buildInitialForm(host: HostDetail): DeviceFormState {
  let snmp: HostSnmpData | null = null;
  try { if (host.snmp_data) snmp = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* ignore */ }

  // F1: prefer server-side auto-classify (inferred_*) over client-side heuristics.
  const hasInferred = !!host.inferred_at;
  const inferredVendor = host.inferred_vendor ?? null;
  const inferredProtocol = host.inferred_protocol ?? null;
  const inferredDeviceType = host.inferred_device_type ?? null;
  const inferredClassification = host.inferred_scan_target ?? null;

  const vendorOptions = new Set([
    "cisco", "mikrotik", "juniper", "ubiquiti", "fortinet", "stormshield", "sonicwall", "draytek",
    "synology", "qnap", "vmware", "proxmox", "hp", "dell", "lenovo", "microsoft", "apple", "other",
  ]);
  const mappedInferredVendor = inferredVendor && vendorOptions.has(inferredVendor) ? inferredVendor : null;
  const vendor = mappedInferredVendor ?? inferVendorFromManufacturer(snmp?.manufacturer ?? host.device_manufacturer ?? null);

  const protocolOptions = new Set(["ssh", "snmp_v2", "snmp_v3", "winrm", "api"]);
  const protocol = (inferredProtocol && protocolOptions.has(inferredProtocol) ? inferredProtocol : null) ?? inferProtocolFromSnmp(snmp);

  let device_type: "router" | "switch" | "hypervisor";
  if (inferredDeviceType === "router" || inferredDeviceType === "switch" || inferredDeviceType === "hypervisor") {
    device_type = inferredDeviceType;
  } else if (inferredDeviceType === "firewall") {
    device_type = "router";
  } else if (inferredDeviceType === "workstation" || inferredDeviceType === "server") {
    device_type = "hypervisor";
  } else {
    device_type = inferDeviceTypeFromClassification(host.classification);
  }

  const port = protocol === "snmp_v2" || protocol === "snmp_v3" ? 161
    : protocol === "winrm" ? 5985
    : 22;

  const protoTypeForCred = protocol === "winrm" ? "winrm"
    : protocol === "api" ? "api"
    : protocol === "snmp_v2" || protocol === "snmp_v3" ? "snmp"
    : "ssh";
  const matchingCred = host.host_credentials?.find((hc) => hc.protocol_type === protoTypeForCred && hc.validated === 1);
  const matchingSnmpCred = host.host_credentials?.find((hc) => hc.protocol_type === "snmp" && hc.validated === 1);

  return {
    name: snmp?.sysName || host.custom_name || host.hostname || host.ip,
    vendor,
    protocol,
    device_type,
    classification: (hasInferred && inferredClassification) ? inferredClassification
      : (host.classification !== "unknown" ? host.classification : ""),
    port,
    model: snmp?.model || host.model || "",
    serial_number: snmp?.serialNumber || host.serial_number || "",
    firmware: snmp?.firmware || host.firmware || "",
    sysname: snmp?.sysName || host.hostname || "",
    sysdescr: snmp?.sysDescr || host.os_info || "",
    community_string: snmp?.community || "",
    vendorSubtype: null,
    productProfile: null,
    scanTarget: inferredClassification,
    credentialId: matchingCred ? String(matchingCred.credential_id) : null,
    snmpCredentialId: matchingSnmpCred ? String(matchingSnmpCred.credential_id) : null,
    useForArpPoll: false,
  };
}

export function PromoteHostDialog({ host, open, onOpenChange, onCreated }: PromoteHostDialogProps) {
  const [form, setForm] = useState<DeviceFormState>(() => buildInitialForm(host));
  const [creating, setCreating] = useState(false);
  const [credentialsList, setCredentialsList] = useState<Array<{ id: number; name: string; credential_type: string }>>([]);

  // Carica le credenziali una volta quando il modale si apre la prima volta
  useEffect(() => {
    if (!open) return;
    fetch("/api/credentials", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ id: number; name: string; credential_type: string }>) => {
        if (Array.isArray(data)) setCredentialsList(data);
      })
      .catch(() => { /* il modale funziona comunque */ });
  }, [open]);

  // Resetta il form quando il modale apre (così cambia host = ricarica defaults)
  useEffect(() => {
    if (open) setForm(buildInitialForm(host));
  }, [open, host]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);

    const deviceTypeForSchema: "router" | "switch" | "firewall" | "hypervisor" =
      form.classification === "router" ? "router"
      : form.classification === "switch" ? "switch"
      : form.classification === "firewall" ? "firewall"
      : "hypervisor";

    const body: Record<string, unknown> = {
      name: form.name,
      host: host.ip,
      device_type: deviceTypeForSchema,
      vendor: form.vendor,
      protocol: form.protocol,
      port: form.port,
      classification: form.classification || undefined,
      vendor_subtype: form.vendorSubtype || undefined,
      product_profile: form.productProfile || undefined,
      scan_target: form.scanTarget || undefined,
      model: form.model || undefined,
      serial_number: form.serial_number || undefined,
      firmware: form.firmware || undefined,
      sysname: form.sysname || undefined,
      sysdescr: form.sysdescr || undefined,
      community_string: form.community_string || undefined,
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
        const data = await res.json();
        toast.error(data.error || "Errore");
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">IP</Label>
                <Input value={host.ip} readOnly className="bg-muted" />
              </div>
            </div>

            <DeviceFormFields
              mode="create"
              credentials={credentialsList}
              idPrefix="promote-host"
              showIdentificazione={false}
              showProfilo={true}
              showCredenziali={true}
              classification={form.classification}
              vendor={form.vendor}
              vendorSubtype={form.vendorSubtype}
              protocol={form.protocol}
              scanTarget={form.scanTarget}
              productProfile={form.productProfile}
              credentialId={form.credentialId}
              snmpCredentialId={form.snmpCredentialId}
              useForArpPoll={form.useForArpPoll}
              onClassificationChange={(v) => setForm((f) => ({ ...f, classification: v }))}
              onVendorChange={(v) => setForm((f) => ({ ...f, vendor: v, vendorSubtype: v !== "hp" ? null : f.vendorSubtype }))}
              onVendorSubtypeChange={(v) => setForm((f) => ({ ...f, vendorSubtype: v }))}
              onProtocolChange={(v) => setForm((f) => ({ ...f, protocol: v, port: v === "snmp_v2" || v === "snmp_v3" ? 161 : v === "winrm" ? 5985 : 22 }))}
              onScanTargetChange={(v) => setForm((f) => ({ ...f, scanTarget: v }))}
              onProductProfileChange={(v) => setForm((f) => ({ ...f, productProfile: v }))}
              onCredentialIdChange={(v) => setForm((f) => ({ ...f, credentialId: v }))}
              onSnmpCredentialIdChange={(v) => setForm((f) => ({ ...f, snmpCredentialId: v }))}
              onUseForArpPollChange={(v) => setForm((f) => ({ ...f, useForArpPoll: v }))}
              defaultClassification="server"
              defaultVendor="other"
              defaultProtocol="ssh"
            />

            <Separator />
            <p className="text-xs text-muted-foreground font-medium">Dati inventario</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Modello</Label><Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Seriale</Label><Input value={form.serial_number} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Firmware</Label><Input value={form.firmware} onChange={(e) => setForm((f) => ({ ...f, firmware: e.target.value }))} /></div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
              <Button type="submit" disabled={creating}>{creating ? "Creazione..." : "Crea dispositivo"}</Button>
            </DialogFooter>
          </form>
        </DialogScrollableArea>
      </DialogContent>
    </Dialog>
  );
}
