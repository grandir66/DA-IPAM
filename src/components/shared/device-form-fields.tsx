"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CredentialAssignmentFields, type CredentialItem } from "./credential-assignment-fields";
import { getClassificationLabel, DEVICE_CLASSIFICATIONS_ORDERED } from "@/lib/device-classifications";
import { Info } from "lucide-react";

function Tip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex ml-1 cursor-help">
      <Info className="h-3 w-3 text-muted-foreground" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md max-w-[220px] whitespace-normal opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

const VENDORS = [
  { value: "mikrotik", label: "MikroTik" },
  { value: "ubiquiti", label: "Ubiquiti" },
  { value: "cisco", label: "Cisco" },
  { value: "hp", label: "HP / Aruba" },
  { value: "omada", label: "TP-Link Omada" },
  { value: "stormshield", label: "Stormshield" },
  { value: "proxmox", label: "Proxmox" },
  { value: "vmware", label: "VMware" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
  { value: "synology", label: "Synology" },
  { value: "qnap", label: "QNAP" },
  { value: "other", label: "Altro" },
] as const;

const PROTOCOLS = [
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" },
  { value: "api", label: "API REST" },
  { value: "winrm", label: "WinRM (Windows)" },
] as const;

const SCAN_TARGETS = [
  { value: "none", label: "Automatico" },
  { value: "proxmox", label: "Proxmox" },
  { value: "vmware", label: "VMware" },
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
] as const;

export type DeviceFormMode = "create" | "edit" | "bulk";

export interface DeviceFormFieldsProps {
  mode: DeviceFormMode;
  credentials: CredentialItem[];
  idPrefix: string;
  /** Solo per create/edit */
  showIdentificazione?: boolean;
  /** Solo per create/edit */
  showProfilo?: boolean;
  /** Sempre */
  showCredenziali?: boolean;
  /** Valori controllati (edit/bulk) */
  name?: string;
  host?: string;
  apiUrl?: string;
  classification?: string;
  vendor?: string;
  vendorSubtype?: string | null;
  protocol?: string;
  scanTarget?: string | null;
  credentialId?: string | null;
  snmpCredentialId?: string | null;
  port?: number;
  inlineUsername?: string;
  onNameChange?: (v: string) => void;
  onHostChange?: (v: string) => void;
  onApiUrlChange?: (v: string) => void;
  onClassificationChange?: (v: string) => void;
  onVendorChange?: (v: string) => void;
  onVendorSubtypeChange?: (v: string | null) => void;
  onProtocolChange?: (v: string) => void;
  onScanTargetChange?: (v: string | null) => void;
  onCredentialIdChange?: (v: string | null) => void;
  onSnmpCredentialIdChange?: (v: string | null) => void;
  /** Default per create */
  defaultClassification?: string;
  defaultVendor?: string;
  defaultProtocol?: string;
  /** Mostra URL API (Proxmox) - quando vendor=proxmox o classification=hypervisor */
  showApiUrl?: boolean;
}

/**
 * Modulo unificato per create, edit e bulk assign dispositivi.
 * Stessa struttura per tutti i gruppi (router, switch, hypervisor, storage, ecc.).
 */
export function DeviceFormFields({
  mode,
  credentials,
  idPrefix,
  showIdentificazione = true,
  showProfilo = true,
  showCredenziali = true,
  name = "",
  host = "",
  apiUrl = "",
  classification = "",
  vendor = "other",
  vendorSubtype = null,
  protocol = "ssh",
  scanTarget = null,
  credentialId = null,
  snmpCredentialId = null,
  port = 22,
  inlineUsername = "",
  onNameChange,
  onHostChange,
  onApiUrlChange,
  onClassificationChange,
  onVendorChange,
  onVendorSubtypeChange,
  onProtocolChange,
  onScanTargetChange,
  onCredentialIdChange,
  onSnmpCredentialIdChange,
  defaultClassification = "router",
  defaultVendor = "mikrotik",
  defaultProtocol = "ssh",
  showApiUrl = false,
}: DeviceFormFieldsProps) {
  const isBulk = mode === "bulk";
  const noChange = isBulk ? "Non modificare" : "";
  const classificationOptions = DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown");

  return (
    <div className="space-y-5">
      {showIdentificazione && (mode === "create" || mode === "edit") && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Identificazione</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                name="name"
                required={!isBulk}
                defaultValue={mode === "edit" ? name : mode === "create" && name ? name : undefined}
                placeholder={mode === "create" ? "Nome del dispositivo" : undefined}
                onChange={(e) => onNameChange?.(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>IP / Host</Label>
              <Input
                name="host"
                required={!isBulk}
                defaultValue={mode === "edit" ? host : mode === "create" && host ? host : undefined}
                placeholder={
                  mode === "create"
                    ? showApiUrl
                      ? "192.168.1.1 oppure 192.168.40.1,2,3,4,5 (più nodi Proxmox)"
                      : "192.168.1.1"
                    : undefined
                }
                onChange={(e) => onHostChange?.(e.target.value)}
              />
            </div>
            {showApiUrl ? (
              <p className="text-xs text-muted-foreground col-span-2 -mt-1">
                Proxmox: più nodi dello stesso /24 come <code className="bg-muted px-1 rounded">192.168.40.1,2,3</code>.
                Lo scan usa <strong>API</strong> e <strong>SSH</strong> su ogni IP e unisce i risultati.
              </p>
            ) : null}
            {showApiUrl && (
              <div className="space-y-2 col-span-2">
                <Label htmlFor={`${idPrefix}-api_url`}>URL API (Proxmox)</Label>
                <Input
                  id={`${idPrefix}-api_url`}
                  name="api_url"
                  defaultValue={mode === "edit" ? apiUrl : undefined}
                  placeholder="Opzionale: https://ip:8006 o http://ip:8006"
                  className="font-mono"
                  onChange={(e) => onApiUrlChange?.(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se vuoto usa IP + porta. Per errore SSL prova <code className="bg-muted px-1 rounded">http://</code>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {showProfilo && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Gruppo e profilo</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                Classificazione
                <Tip text="Categoria in cui appare nella lista dispositivi (es. Router, Switch, Storage)." />
              </Label>
              <Select
                value={classification || (isBulk ? "" : defaultClassification)}
                onValueChange={(v) => onClassificationChange?.(v ?? "")}
              >
                <SelectTrigger><SelectValue placeholder={noChange || "Seleziona"} /></SelectTrigger>
                <SelectContent>
                  {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                  {classificationOptions.map((c) => (
                    <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                Vendor
                <Tip text="Profilo che determina i comandi SSH/SNMP usati per acquisire dati (es. MikroTik, Cisco, HP)." />
              </Label>
              <Select
                value={vendor || (isBulk ? "" : defaultVendor)}
                onValueChange={(v) => { onVendorChange?.(v ?? ""); if (v !== "hp") onVendorSubtypeChange?.(null); }}
              >
                <SelectTrigger><SelectValue placeholder={noChange} /></SelectTrigger>
                <SelectContent>
                  {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                  {VENDORS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {vendor === "hp" && (
              <div className="space-y-1">
                <Label className="text-xs">Sottotipo HP</Label>
                <Select
                  value={vendorSubtype ?? "none"}
                  onValueChange={(v) => onVendorSubtypeChange?.(v === "none" ? null : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Generico</SelectItem>
                    <SelectItem value="procurve">ProCurve / Aruba</SelectItem>
                    <SelectItem value="comware">Comware</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                Protocollo
                <Tip text="Come connettersi: SSH per comandi, SNMP per porte/LLDP, WinRM per Windows." />
              </Label>
              <Select
                value={protocol || (isBulk ? "" : defaultProtocol)}
                onValueChange={(v) => onProtocolChange?.(v ?? "")}
              >
                <SelectTrigger><SelectValue placeholder={noChange} /></SelectTrigger>
                <SelectContent>
                  {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                Tipo scansione
                <Tip text="Forza il tipo di scan. Automatico = rilevato da vendor/protocollo." />
              </Label>
              <Select
                value={scanTarget ?? "none"}
                onValueChange={(v) => onScanTargetChange?.(v === "none" ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Automatico" /></SelectTrigger>
                <SelectContent>
                  {SCAN_TARGETS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {!showProfilo && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Gruppo</p>
          <div className="space-y-1">
            <Label className="text-xs">Classificazione</Label>
            <Select
              value={classification || (isBulk ? "" : defaultClassification)}
              onValueChange={(v) => onClassificationChange?.(v ?? "")}
            >
              <SelectTrigger><SelectValue placeholder={noChange || "Seleziona"} /></SelectTrigger>
              <SelectContent>
                {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                {classificationOptions.map((c) => (
                  <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {showCredenziali && onCredentialIdChange && onSnmpCredentialIdChange && (
        <CredentialAssignmentFields
          credentials={credentials}
          credentialId={credentialId}
          snmpCredentialId={snmpCredentialId}
          onCredentialIdChange={onCredentialIdChange}
          onSnmpCredentialIdChange={onSnmpCredentialIdChange}
          credentialPlaceholder={isBulk ? noChange : "Nessuna (credenziali inline)"}
          snmpPlaceholder={isBulk ? noChange : "Nessuna"}
          showInlineCreds={!isBulk && (protocol === "ssh" || protocol === "api" || protocol === "winrm")}
          inlineUsername={inlineUsername}
          showPortAndCommunity={!isBulk}
          portDefaultValue={port}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
}
