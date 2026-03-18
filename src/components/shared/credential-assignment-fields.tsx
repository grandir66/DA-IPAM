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
}: CredentialAssignmentFieldsProps) {
  const sshCreds = credentials.filter((c) =>
    sshFilter === "ssh_api_windows"
      ? c.credential_type === "ssh" || c.credential_type === "api" || c.credential_type === "windows"
      : c.credential_type === "ssh" || c.credential_type === "api"
  );
  const snmpCreds = credentials.filter((c) => c.credential_type === "snmp");

  const hasStoredCred = credentialId && credentialId !== "none";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Credenziali di accesso</p>

        {/* Riga 1: Credenziali da archivio — SSH e SNMP affiancate */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              SSH / API / Windows
              <Tip text="Da archivio: usa username e password della credenziale registrata. Se 'Nessuna', usa i campi inline sotto." />
            </Label>
            <Select value={credentialId ?? "none"} onValueChange={(v) => onCredentialIdChange(v === "none" ? null : v)}>
              <SelectTrigger className="bg-background">
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

          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              SNMP
              <Tip text="Community string dall'archivio. Se 'Nessuna', usa il campo Community SNMP sotto. Usata per porte, LLDP, spanning tree." />
            </Label>
            <Select value={snmpCredentialId ?? "none"} onValueChange={(v) => onSnmpCredentialIdChange(v === "none" ? null : v)}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder={snmpPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{snmpPlaceholder}</SelectItem>
                {snmpCreds.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
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
                <Tip text="Community string diretta. Ignorata se una credenziale SNMP dall'archivio è selezionata sopra." />
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
