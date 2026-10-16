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

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { etichettaVersioneSnmp } from "@/lib/protocols/snmp-sessione";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { DeviceCredentialsTable } from "@/components/shared/device-credentials-table";
import { getClassificationLabel } from "@/lib/device-classifications";
import { isProxmoxVeDevice } from "@/lib/devices/device-acquisition-resolve";
import { applyProductProfileScanDefaults, type ProductProfileId } from "@/lib/device-product-profiles";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { DeviceLocationField } from "@/components/topology/device-location-field";
import { toast } from "sonner";
import type { NetworkDevice } from "@/types";
import { corpoModificaApparato, tendineDaApparato } from "@/app/(dashboard)/devices/modifica-in-blocco";
import { avvisoPortaProtocollo, portaAlCambioProtocollo, type BindingPorta } from "@/lib/devices/porta-protocollo";
import type { CredenzialeArchivio, ProtocolloApparato } from "@/lib/devices/proposta-apparato";

/** «auto» = la sceglie la discovery (v2c, poi v1); «1»/«2c» = fissata a mano. */
type SceltaVersioneSnmp = "auto" | "1" | "2c";

function sceltaVersioneSnmp(device: NetworkDevice): SceltaVersioneSnmp {
  return device.snmp_version_fissata === 1 && device.snmp_version ? device.snmp_version : "auto";
}

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
  const [editSnmpVersione, setEditSnmpVersione] = useState<SceltaVersioneSnmp>(() => sceltaVersioneSnmp(device));
  // Porta controllata (16/10): cambiando protocollo segue il nuovo (prima restava quella vecchia: SSH sulla 161).
  const [editPort, setEditPort] = useState<string>(device.port != null ? String(device.port) : "");
  const [editSaving, setEditSaving] = useState(false);
  const saveLocation = useRef<() => Promise<string | null>>(async () => null);
  const registerLocationSave = useCallback((f: () => Promise<string | null>) => {
    saveLocation.current = f;
  }, []);
  const [credentials, setCredentials] = useState<CredenzialeArchivio[]>([]);
  // I binding della tabella qui sotto: la porta SSH dell'apparato sta lì (binding sulla 2222), non nelle colonne.
  const [binding, setBinding] = useState<BindingPorta[]>([]);

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
    setEditSnmpVersione(sceltaVersioneSnmp(device));
    setEditPort(device.port != null ? String(device.port) : "");
  }, [device]);

  // Carica credenziali quando il modale si apre
  useEffect(() => {
    if (!open) return;
    fetch("/api/credentials", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CredenzialeArchivio[]) => {
        if (Array.isArray(data)) setCredentials(data);
      })
      .catch(() => { /* modale funziona comunque */ });
  }, [open]);

  /**
   * Cambio di protocollo: la porta passa a quella del nuovo (binding, voce
   * compatibile, o lo standard); verso SNMP resta (è la porta del ripiego SSH);
   * tornando al protocollo salvato torna la porta salvata; Proxmox tiene la porta
   * dell'API. Una porta scritta a mano dopo il cambio resta: la sovrascrive solo un altro cambio.
   */
  function cambiaProtocollo(
    v: NetworkDevice["protocol"],
    nuovo: { product_profile?: string | null; scan_target?: string | null } = {},
  ) {
    if (v === editProtocol) return;
    setEditProtocol(v);
    const proxmox = isProxmoxVeDevice({
      vendor: editVendor,
      protocol: v,
      scan_target: nuovo.scan_target !== undefined ? nuovo.scan_target : editScanTarget,
      product_profile: nuovo.product_profile !== undefined ? nuovo.product_profile : editProductProfile,
      classification: editClassification || device.classification,
    });
    const attuale = Number(editPort);
    setEditPort(String(portaAlCambioProtocollo({
      protocollo: v as ProtocolloApparato,
      credenziali: [editCredentialId, editSnmpCredentialId],
      archivio: credentials,
      binding,
      proxmox,
      portaAttuale: editPort.trim() !== "" && Number.isInteger(attuale) && attuale > 0 ? attuale : null,
      salvata: { protocollo: device.protocol, porta: device.port },
    })));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditSaving(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    // Le credenziali partono solo se cambiate rispetto all'apparato (dalla 2e un null toglie i binding).
    let body: Record<string, unknown>;
    try {
      body = corpoModificaApparato({ ...tendineDaApparato(device), porta: device.port }, {
        campi: {
          vendor: editVendor,
          protocol: editProtocol,
          vendor_subtype: editVendorSubtype || null,
          scan_target: editScanTarget || null,
        },
        credentialId: editCredentialId,
        snmpCredentialId: editSnmpCredentialId,
        porta: editPort,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Credenziale o porta non valida");
      setEditSaving(false);
      return;
    }
    if (editProductProfile) body.product_profile = editProductProfile;
    if (editClassification) body.classification = editClassification;
    body.use_for_arp_poll = editUseForArpPoll ? 1 : 0;
    if (editSnmpVersione !== sceltaVersioneSnmp(device)) body.snmp_version_scelta = editSnmpVersione;
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
        const updated = await res.json() as NetworkDevice & { avvisi?: string[] };
        for (const a of updated.avvisi ?? []) toast.warning(a);
        const errLoc = await saveLocation.current();
        if (errLoc) {
          // L'apparato è salvato, la sede no: la finestra resta aperta con l'errore.
          toast.error(errLoc);
          onSaved?.(updated);
        } else {
          toast.success("Dispositivo aggiornato");
          onOpenChange(false);
          onSaved?.(updated);
        }
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
    isProxmoxVeDevice({
      vendor: editVendor,
      protocol: editProtocol,
      scan_target: editScanTarget,
      product_profile: editProductProfile,
      classification: editClassification || device.classification,
    }) || device.device_type === "hypervisor";

  const portaScritta = Number(editPort);
  const avvisoPorta = editPort.trim() === "" ? null : avvisoPortaProtocollo({
    vendor: editVendor,
    protocol: editProtocol,
    scan_target: editScanTarget,
    product_profile: editProductProfile,
    classification: editClassification || device.classification,
    port: Number.isInteger(portaScritta) ? portaScritta : null,
  });

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
                      Scan Proxmox: su ogni IP si usano API (la porta API qui sotto, di solito 8006) e SSH (porta della credenziale SSH, o 22); più nodi stesso /24 con virgole dopo il primo IP.
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
              onProtocolChange={(v) => cambiaProtocollo(v as NetworkDevice["protocol"])}
              onScanTargetChange={setEditScanTarget}
              onProductProfileChange={(v) => {
                setEditProductProfile(v);
                if (!v) return;
                const pid = v as ProductProfileId;
                const defaults = applyProductProfileScanDefaults(pid, editVendor, editClassification || null);
                setEditVendorSubtype(defaults.vendor_subtype);
                if (defaults.scan_target != null) setEditScanTarget(defaults.scan_target);
                if (defaults.protocol) {
                  cambiaProtocollo(defaults.protocol, { product_profile: v, scan_target: defaults.scan_target ?? editScanTarget });
                }
                setEditUseForArpPoll(defaults.use_for_arp_poll === 1);
              }}
              useForArpPoll={editUseForArpPoll}
              onUseForArpPollChange={setEditUseForArpPoll}
              defaultUseForArpPoll={editClassification === "router" || editClassification === "firewall"}
            />

            <div className="space-y-1">
              <Label className="text-xs" htmlFor="edit-device-port">
                {isProxmoxVeDevice({ vendor: editVendor, protocol: editProtocol, scan_target: editScanTarget, product_profile: editProductProfile, classification: editClassification || device.classification })
                  ? "Porta API"
                  : "Porta"}
              </Label>
              <Input
                id="edit-device-port"
                type="number"
                min={1}
                max={65535}
                value={editPort}
                onChange={(e) => setEditPort(e.target.value)}
                className="max-w-[12rem] font-mono"
              />
              {avvisoPorta && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-200/90">
                  {avvisoPorta}
                </p>
              )}
            </div>

            {editProtocol !== "snmp_v3" && (
              <div className="space-y-1">
                <Label className="text-xs">Versione SNMP</Label>
                <Select value={editSnmpVersione} onValueChange={(v) => setEditSnmpVersione((v ?? "auto") as SceltaVersioneSnmp)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {device.snmp_version && device.snmp_version_fissata !== 1
                        ? `Automatica (rilevata: ${etichettaVersioneSnmp(device.snmp_version)})`
                        : "Automatica (non ancora rilevata)"}
                    </SelectItem>
                    <SelectItem value="1">v1, fissata a mano</SelectItem>
                    <SelectItem value="2c">v2c, fissata a mano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DeviceLocationField deviceId={device.id} onReady={registerLocationSave} />

            <DeviceCredentialsTable deviceId={device.id} onBindingsChange={setBinding} />

            <Button type="submit" className="w-full" disabled={editSaving}>
              {editSaving ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          </form>
        </DialogScrollableArea>
      </DialogContent>
    </Dialog>
  );
}
