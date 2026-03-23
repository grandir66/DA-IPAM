"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";

export interface CredentialItem {
  id: number;
  name: string;
  credential_type: string;
}

/** Seconda colonna SNMP: sempre con etichetta diversa dalla credenziale principale (evita duplicati visivi). */
export const CREDENTIAL_SNMP_SECONDARY_SELECT_LABEL =
  "Credenziale SNMP — porte e topologia (archivio)";

/** Titoli sezione / etichetta select in base al protocollo principale (modifica dispositivo). */
export function getPrimaryCredentialLabels(protocol: string): { section: string; select: string } {
  switch (protocol) {
    case "ssh":
      return { section: "SSH — shell e comandi", select: "Credenziale da archivio (SSH / API / Windows)" };
    case "winrm":
      return { section: "WinRM — Windows", select: "Credenziale Windows / WinRM (archivio)" };
    case "api":
      return { section: "API REST", select: "Credenziale API (archivio)" };
    case "snmp_v2":
      return {
        section: "SNMP v2 — gestione",
        select: "Credenziale SNMP — gestione dispositivo (archivio)",
      };
    case "snmp_v3":
      return {
        section: "SNMP v3 — gestione",
        select: "Credenziale SNMP — gestione dispositivo (archivio)",
      };
    default:
      return { section: "Accesso principale", select: "Credenziale (archivio)" };
  }
}

export interface CredentialAssignmentFieldsProps {
  credentials: CredentialItem[];
  credentialId: string | null;
  snmpCredentialId: string | null;
  onCredentialIdChange: (value: string | null) => void;
  onSnmpCredentialIdChange: (value: string | null) => void;
  sshFilter?: "ssh_api" | "ssh_api_windows";
  credentialPlaceholder?: string;
  snmpPlaceholder?: string;
  showInlineCreds?: boolean;
  inlineUsername?: string;
  inlinePasswordPlaceholder?: string;
  showPortAndCommunity?: boolean;
  portDefaultValue?: number;
  communityPlaceholder?: string;
  idPrefix?: string;
  testButton?: React.ReactNode;
  /** Titolo sezione credenziale principale (dipende da protocollo: SSH, WinRM, SNMP, API). */
  primarySectionTitle?: string;
  /** Etichetta select credenziale principale. */
  primarySelectLabel?: string;
  /** Titolo sezione SNMP separata. */
  snmpSectionTitle?: string;
  /** Etichetta select SNMP. */
  snmpSelectLabel?: string;
}

function Tip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex ml-1 cursor-help">
      <Info className="h-3 w-3 text-muted-foreground" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md whitespace-nowrap opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

export function CredentialAssignmentFields({
  credentials,
  credentialId,
  snmpCredentialId,
  onCredentialIdChange,
  onSnmpCredentialIdChange,
  sshFilter = "ssh_api_windows",
  credentialPlaceholder = "Nessuna (credenziali inline)",
  snmpPlaceholder = "Nessuna",
  showInlineCreds = false,
  inlineUsername = "",
  inlinePasswordPlaceholder = "Lascia vuoto per non modificare",
  showPortAndCommunity = false,
  portDefaultValue = 22,
  communityPlaceholder = "Lascia vuoto per non modificare",
  idPrefix = "cred",
  testButton,
  primarySectionTitle = "Accesso principale",
  primarySelectLabel = "SSH / API / Windows",
  snmpSectionTitle = "SNMP aggiuntivo (porte, LLDP, spanning tree)",
  snmpSelectLabel = CREDENTIAL_SNMP_SECONDARY_SELECT_LABEL,
}: CredentialAssignmentFieldsProps) {
  const sshCreds = credentials
    .filter((c) =>
      sshFilter === "ssh_api_windows"
        ? c.credential_type === "ssh" || c.credential_type === "api" || c.credential_type === "windows"
        : c.credential_type === "ssh" || c.credential_type === "api"
    )
    .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
  const snmpCreds = credentials
    .filter((c) => c.credential_type === "snmp")
    .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));

  const hasStoredCred = credentialId && credentialId !== "none";

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credenziali di accesso</p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start md:gap-4">
          <div className="min-w-0 space-y-1.5 rounded-md border border-border/50 bg-background/50 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{primarySectionTitle}</p>
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                {primarySelectLabel}
                <Tip text="Da archivio: usa username e password della credenziale registrata. Se 'Nessuna', usa i campi inline sotto." />
              </Label>
              <Select value={credentialId ?? "none"} onValueChange={(v) => onCredentialIdChange(v === "none" ? null : v)}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder={credentialPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{credentialPlaceholder}</SelectItem>
                  {sshCreds.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                      <span className="ml-2 text-xs text-muted-foreground uppercase">({c.credential_type})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-w-0 space-y-1.5 rounded-md border border-border/50 bg-background/50 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{snmpSectionTitle}</p>
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                {snmpSelectLabel}
                <Tip text="Opzionale se diversa dalla gestione: community da archivio per walk su porte, LLDP, spanning tree. Se «Nessuna», usa la community sotto (o la stessa della gestione)." />
              </Label>
              <Select value={snmpCredentialId ?? "none"} onValueChange={(v) => onSnmpCredentialIdChange(v === "none" ? null : v)}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder={snmpPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{snmpPlaceholder}</SelectItem>
                  {snmpCreds.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Riga 2: Credenziali inline — sempre visibili se showInlineCreds, disabilitate se credenziale archivio selezionata */}
        {showInlineCreds && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
            <div className="space-y-1">
              <Label className="text-xs flex items-center" htmlFor={`${idPrefix}-username`}>
                Username
                <Tip text="Username per connessione diretta. Ignorato se una credenziale dall'archivio è selezionata sopra." />
              </Label>
              <Input
                id={`${idPrefix}-username`}
                name="username"
                defaultValue={inlineUsername}
                placeholder="admin"
                className="bg-background"
                disabled={!!hasStoredCred}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center" htmlFor={`${idPrefix}-password`}>
                Password
                <Tip text="Password per connessione diretta. Ignorata se una credenziale dall'archivio è selezionata." />
              </Label>
              <Input
                id={`${idPrefix}-password`}
                name="password"
                type="password"
                placeholder={inlinePasswordPlaceholder}
                className="bg-background"
                disabled={!!hasStoredCred}
              />
            </div>
          </div>
        )}

        {/* Riga 3: Porta e community SNMP — sempre visibili se showPortAndCommunity */}
        {showPortAndCommunity && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center" htmlFor={`${idPrefix}-port`}>
                Porta
                <Tip text="Porta di connessione (SSH=22, SNMP=161, API=443, WinRM=5985)." />
              </Label>
              <Input
                id={`${idPrefix}-port`}
                name="port"
                type="number"
                defaultValue={portDefaultValue}
                placeholder="22"
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center" htmlFor={`${idPrefix}-community`}>
                Community SNMP
                <Tip text="Community inline se non usi credenziali SNMP dalle due liste sopra (gestione o porte/topologia)." />
              </Label>
              <Input
                id={`${idPrefix}-community`}
                name="community_string"
                type="password"
                placeholder={communityPlaceholder}
                className="bg-background"
                disabled={!!(snmpCredentialId && snmpCredentialId !== "none")}
              />
            </div>
          </div>
        )}
      </div>
      {testButton && (
        <div className="flex justify-end">
          {testButton}
        </div>
      )}
    </div>
  );
}
