"use client";

import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CredentialAssignmentFields,
  CREDENTIAL_SNMP_SECONDARY_SELECT_LABEL,
  getPrimaryCredentialLabels,
  type CredentialItem,
} from "./credential-assignment-fields";
import {
  getClassificationLabel,
  DEVICE_CLASSIFICATIONS_ORDERED,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import {
  getVendorDeviceProfile,
  coerceProtocolForVendor,
  coerceScanTargetForVendor,
  scanTargetToSelectValue,
  type ScanTargetKey,
} from "@/lib/vendor-device-profile";
import {
  getProductProfilesForVendor,
  getDefaultProductProfileForVendor,
  isValidProductProfileForVendor,
  vendorSubtypeFromProductProfile,
  productProfileRequiresNamedCredential,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
import type { NetworkDevice } from "@/types";
import {
  getDefaultNetworkDeviceVendorOptions,
  type NetworkDeviceVendorSelectOption,
} from "@/lib/network-device-vendor-options";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

function Tip({ text, wide }: { text: string; wide?: boolean }) {
  return (
    <span className="relative group/tip inline-flex shrink-0 ml-0.5 cursor-help align-middle">
      <Info className="h-3 w-3 text-muted-foreground" />
      <span
        className={cn(
          "absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity pointer-events-none group-hover/tip:pointer-events-auto group-hover/tip:opacity-100",
          wide ? "max-w-[min(20rem,calc(100vw-2rem))] whitespace-pre-line" : "max-w-[220px] whitespace-normal"
        )}
      >
        {text}
      </span>
    </span>
  );
}

/** Riga campo: etichetta + info sulla stessa riga, controllo sotto — allinea le colonne in griglia. */
function FieldRow({
  label,
  tip,
  tipWide,
  children,
}: {
  label: string;
  tip: string;
  tipWide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-[1.25rem] items-center gap-0.5">
        <Label className="text-xs font-medium leading-none">{label}</Label>
        <Tip text={tip} wide={tipWide} />
      </div>
      {children}
    </div>
  );
}

const PROTOCOLS = [
  { value: "ssh", label: "SSH" },
  { value: "snmp_v2", label: "SNMP v2" },
  { value: "snmp_v3", label: "SNMP v3" },
  { value: "api", label: "API REST" },
  { value: "winrm", label: "WinRM / WMI" },
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
  /** Profilo prodotto (marca + tipologia): obbligatorio per acquisizione inventario dedicata */
  productProfile?: string | null;
  onProductProfileChange?: (v: string | null) => void;
  onCredentialIdChange?: (v: string | null) => void;
  onSnmpCredentialIdChange?: (v: string | null) => void;
  /** Default per create */
  defaultClassification?: string;
  defaultVendor?: string;
  defaultProtocol?: string;
  /** Mostra URL API (Proxmox) - quando vendor=proxmox o classification=hypervisor */
  showApiUrl?: boolean;
  /** Opzioni vendor (es. test). Se omesso, caricamento da GET /api/device-vendor-options */
  vendorOptions?: NetworkDeviceVendorSelectOption[];
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
  productProfile = null,
  onProductProfileChange,
  onCredentialIdChange,
  onSnmpCredentialIdChange,
  defaultClassification = "router",
  defaultVendor = "mikrotik",
  defaultProtocol = "ssh",
  showApiUrl = false,
  vendorOptions: vendorOptionsProp,
}: DeviceFormFieldsProps) {
  const isBulk = mode === "bulk";
  const noChange = isBulk ? "Non modificare" : "";
  const classificationOptionsSorted = useMemo(
    () => sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown")),
    []
  );

  const [vendorOptions, setVendorOptions] = useState<NetworkDeviceVendorSelectOption[]>(() =>
    vendorOptionsProp ?? getDefaultNetworkDeviceVendorOptions()
  );

  useEffect(() => {
    if (vendorOptionsProp) {
      setVendorOptions(vendorOptionsProp);
      return;
    }
    let cancelled = false;
    fetch("/api/device-vendor-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { options?: NetworkDeviceVendorSelectOption[] } | null) => {
        if (cancelled || !data?.options?.length) return;
        setVendorOptions(data.options);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vendorOptionsProp]);

  const [detecting, setDetecting] = useState(false);
  const handleDetectProtocol = useCallback(async () => {
    if (!host) return;
    setDetecting(true);
    try {
      const res = await fetch("/api/devices/detect-protocol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, timeout: 4000 }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.protocol) {
        onProtocolChange?.(data.protocol);
      }
    } catch { /* ignore */ }
    finally { setDetecting(false); }
  }, [host, onProtocolChange]);

  const vendorProfile = getVendorDeviceProfile(vendor || "other");
  const primaryCredentialLabels = useMemo(
    () => getPrimaryCredentialLabels(protocol ?? "ssh"),
    [protocol]
  );
  const protocolOptions = PROTOCOLS.filter((p) =>
    vendorProfile.allowedProtocols.includes(p.value as NetworkDevice["protocol"])
  ).sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
  const scanTargetOptions = useMemo(() => {
    const profile = getVendorDeviceProfile(vendor || "other");
    return SCAN_TARGETS.filter((s) => profile.allowedScanTargets.includes(s.value as ScanTargetKey)).sort((a, b) =>
      a.label.localeCompare(b.label, "it", { sensitivity: "base" })
    );
  }, [vendor]);
  const productProfileOptions = useMemo(
    () =>
      [...getProductProfilesForVendor(vendor || "other")].sort((a, b) =>
        a.label.localeCompare(b.label, "it", { sensitivity: "base" })
      ),
    [vendor]
  );

  const vendorOptionsSorted = useMemo(
    () => [...vendorOptions].sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" })),
    [vendorOptions]
  );

  // Allinea protocollo e tipo scansione al profilo vendor (es. dati DB incoerenti dopo cambio manuale)
  useEffect(() => {
    if (isBulk && !vendor) return;
    const pv = vendor || "other";
    const nextP = coerceProtocolForVendor(pv, protocol);
    if (nextP !== protocol) onProtocolChange?.(nextP);
    const nextS = coerceScanTargetForVendor(pv, scanTarget ?? undefined);
    if (nextS !== (scanTarget ?? null)) onScanTargetChange?.(nextS);
  }, [vendor, isBulk, protocol, scanTarget, onProtocolChange, onScanTargetChange]);

  // Profilo prodotto coerente con la marca
  useEffect(() => {
    if (!onProductProfileChange) return;
    const pv = vendor || "other";
    if (!productProfile || !isValidProductProfileForVendor(pv, productProfile)) {
      onProductProfileChange(getDefaultProductProfileForVendor(pv));
    }
  }, [vendor, productProfile, onProductProfileChange]);

  const vendorMarcaTip =
    "Solo la marca del dispositivo. Protocollo, tipo scansione e credenziali seguono il profilo vendor; le scansioni non modificano la marca. " +
    "Nel menu marca, passa il mouse sulle voci per OID/IPAM se presenti.\n\n" +
    vendorProfile.shortHint;

  return (
    <div className="space-y-4">
      {showIdentificazione && (mode === "create" || mode === "edit") && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificazione</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                name="name"
                required={!isBulk}
                defaultValue={mode === "edit" ? name : mode === "create" && name ? name : undefined}
                placeholder={mode === "create" ? "Nome del dispositivo" : undefined}
                onChange={(e) => onNameChange?.(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">IP / Host</Label>
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
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profilo dispositivo</p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            <FieldRow
              label="Classificazione"
              tip="Categoria in lista dispositivi (Router, Switch, Storage, …)."
            >
              <Select
                value={classification || (isBulk ? "" : defaultClassification)}
                onValueChange={(v) => onClassificationChange?.(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={noChange || "Seleziona"} />
                </SelectTrigger>
                <SelectContent>
                  {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                  {classificationOptionsSorted.map((c) => (
                    <SelectItem key={c} value={c}>
                      {getClassificationLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow label="Marca (vendor)" tip={vendorMarcaTip} tipWide>
              <Select
                value={vendor || (isBulk ? "" : defaultVendor)}
                onValueChange={(v) => {
                  const nv = v ?? "";
                  onVendorChange?.(nv);
                  const nextProto = coerceProtocolForVendor(nv, protocol);
                  if (nextProto !== protocol) onProtocolChange?.(nextProto);
                  const nextSt = coerceScanTargetForVendor(nv, scanTarget ?? undefined);
                  if (nextSt !== (scanTarget ?? null)) onScanTargetChange?.(nextSt);
                  const defP = getDefaultProductProfileForVendor(nv);
                  onProductProfileChange?.(defP);
                  onVendorSubtypeChange?.(vendorSubtypeFromProductProfile(defP as ProductProfileId));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={noChange || "Scegli marca"} />
                </SelectTrigger>
                <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
                  {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                  {vendorOptionsSorted.map((v) => (
                    <SelectItem
                      key={v.value}
                      value={v.value}
                      title={v.hint ? `${v.label}. ${v.hint}` : v.label}
                    >
                      <span className="truncate">{v.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>

          {onProductProfileChange && (
            <FieldRow
              label="Tipologia prodotto"
              tip="Dettaglio per questa marca (es. switch gestito). Influenza scan e inventario. Catalogo OID: Impostazioni → SNMP."
              tipWide
            >
              <Select
                value={productProfile ?? getDefaultProductProfileForVendor(vendor)}
                onValueChange={(v) => {
                  if (!v) return;
                  onProductProfileChange(v);
                  onVendorSubtypeChange?.(vendorSubtypeFromProductProfile(v as ProductProfileId));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {productProfileOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}

          <div className="grid grid-cols-1 gap-3 border-t border-border/40 pt-3 sm:grid-cols-2 sm:gap-4">
            <FieldRow
              label="Protocollo principale"
              tip="Connessione per query e comandi (SSH, SNMP, API, WinRM). Con SNMP puoi aggiungere credenziale SNMP sotto per porte/LLDP."
              tipWide
            >
              <div className="flex gap-2">
                <Select
                  value={protocol || (isBulk ? "" : defaultProtocol)}
                  onValueChange={(v) => onProtocolChange?.(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={noChange} />
                  </SelectTrigger>
                  <SelectContent>
                    {isBulk && <SelectItem value="">{noChange}</SelectItem>}
                    {protocolOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isBulk && host && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs"
                    disabled={detecting}
                    onClick={handleDetectProtocol}
                  >
                    {detecting ? "..." : "Rileva"}
                  </Button>
                )}
              </div>
            </FieldRow>

            <FieldRow
              label="Tipo scansione"
              tip="Solo per hypervisor (es. Proxmox VE vs PBS). «Automatico» non disattiva le query: con SNMP/SSH il dispositivo viene comunque interrogato."
            >
              <Select
                value={scanTargetToSelectValue(scanTarget ?? null)}
                onValueChange={(v) => onScanTargetChange?.(v === "none" ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Automatico" />
                </SelectTrigger>
                <SelectContent>
                  {scanTargetOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
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
                {classificationOptionsSorted.map((c) => (
                  <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {showCredenziali && onCredentialIdChange && onSnmpCredentialIdChange && (
        <>
          {productProfile &&
            productProfileRequiresNamedCredential(productProfile as ProductProfileId) &&
            (!credentialId || credentialId === "none") && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-200/90">
                Assegna una <strong>credenziale nominata</strong> dall&apos;archivio per dispositivi gestiti (profilo prodotto e test connessione).
              </p>
            )}
          <CredentialAssignmentFields
            credentials={credentials}
            credentialId={credentialId}
            snmpCredentialId={snmpCredentialId}
            onCredentialIdChange={onCredentialIdChange}
            onSnmpCredentialIdChange={onSnmpCredentialIdChange}
            sshFilter={vendorProfile.credentialSshFilter}
            primarySectionTitle={primaryCredentialLabels.section}
            primarySelectLabel={primaryCredentialLabels.select}
            snmpSectionTitle="SNMP aggiuntivo (porte, LLDP, spanning tree)"
            snmpSelectLabel={CREDENTIAL_SNMP_SECONDARY_SELECT_LABEL}
            credentialPlaceholder={isBulk ? noChange : "Nessuna (credenziali inline)"}
            snmpPlaceholder={isBulk ? noChange : "Nessuna"}
            showInlineCreds={!isBulk && (protocol === "ssh" || protocol === "api" || protocol === "winrm")}
            inlineUsername={inlineUsername}
            showPortAndCommunity={!isBulk}
            portDefaultValue={port}
            idPrefix={idPrefix}
          />
        </>
      )}
    </div>
  );
}
