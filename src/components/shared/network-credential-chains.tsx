"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type CredentialRow = { id: number; name: string; credential_type: string };

type Role = "windows" | "linux" | "ssh" | "snmp";

const ROLE_META: Record<Role, { title: string; hint: string }> = {
  windows: {
    title: "WinRM — host Windows",
    hint: "Credenziali tipo Windows: usate in sequenza per WinRM (hostname, contesto OS) sugli host selezionati con porte SMB/WinRM da Nmap.",
  },
  linux: {
    title: "Account Linux (OS)",
    hint: "Credenziali tipo Linux: accesso SSH per hostname, kernel e informazioni di base da shell.",
  },
  ssh: {
    title: "SSH — dispositivi / appliance",
    hint: "Credenziali tipo SSH su switch, NAS, ecc.; ordine: catena qui → account Linux sopra → globale in Impostazioni.",
  },
  snmp: {
    title: "SNMP",
    hint: "Community (o stringhe da credenziali tipo SNMP) provate in ordine, poi il campo «Community SNMP» della rete e infine public/private.",
  },
};

function matchesRole(credentialType: string, role: Role): boolean {
  const t = credentialType.toLowerCase();
  if (role === "windows") return t === "windows";
  if (role === "linux") return t === "linux";
  if (role === "ssh") return t === "ssh";
  return t === "snmp";
}

function ChainSection({
  role,
  ids,
  onChange,
  credentials,
  onAfterCreateCredential,
}: {
  role: Role;
  ids: number[];
  onChange: (ids: number[]) => void;
  credentials: CredentialRow[];
  onAfterCreateCredential: () => Promise<void>;
}) {
  const filtered = credentials.filter((c) => matchesRole(c.credential_type, role));
  const [inlineOpen, setInlineOpen] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [inlineUser, setInlineUser] = useState("");
  const [inlinePass, setInlinePass] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);

  const move = (index: number, delta: -1 | 1) => {
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(ids.filter((_, i) => i !== index));
  };

  const addId = (id: number) => {
    if (ids.includes(id)) return;
    onChange([...ids, id]);
  };

  const createInline = async () => {
    const ctype =
      role === "windows"
        ? "windows"
        : role === "linux"
          ? "linux"
          : role === "ssh"
            ? "ssh"
            : "snmp";
    if (!inlineName.trim()) {
      toast.error("Nome obbligatorio");
      return;
    }
    if (ctype === "snmp") {
      if (!inlinePass.trim()) {
        toast.error("Inserisci la community SNMP");
        return;
      }
    } else if (!inlineUser.trim() || !inlinePass.trim()) {
      toast.error("Username e password obbligatori");
      return;
    }
    const body: Record<string, unknown> = {
      name: inlineName.trim(),
      credential_type: ctype,
      password: inlinePass,
    };
    if (ctype !== "snmp") body.username = inlineUser.trim();
    setInlineSaving(true);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Creazione fallita");
        return;
      }
      const newId = data.id as number | undefined;
      if (newId != null && newId > 0) {
        addId(newId);
        await onAfterCreateCredential();
        setInlineName("");
        setInlineUser("");
        setInlinePass("");
        setInlineOpen(false);
        toast.success("Credenziale creata e aggiunta alla catena");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setInlineSaving(false);
    }
  };

  const meta = ROLE_META[role];

  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 p-3 space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
        <div>
          <p className="text-sm font-medium">{meta.title}</p>
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        {ids.length < 3 && (
          <span className="text-xs text-amber-700 dark:text-amber-400 shrink-0">
            Consiglio: almeno 3 credenziali in ordine di priorità
          </span>
        )}
      </div>
      {ids.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessuna credenziale in catena (verranno usate solo le impostazioni globali, se presenti).</p>
      ) : (
        <ul className="space-y-1">
          {ids.map((cid, i) => {
            const c = credentials.find((x) => x.id === cid);
            return (
              <li
                key={`${role}-${cid}-${i}`}
                className="flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-1"
              >
                <span className="text-sm flex-1 min-w-0 truncate">
                  {c?.name ?? `ID ${cid}`}
                  {c && (
                    <span className="ml-1 text-xs text-muted-foreground uppercase">({c.credential_type})</span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="Sposta su"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Sposta giù"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive"
                  onClick={() => removeAt(i)}
                  aria-label="Rimuovi"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="flex h-9 w-[min(100%,280px)] rounded-md border border-input bg-background px-3 py-1 text-sm"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              addId(Number(v));
              e.target.value = "";
            }
          }}
          aria-label={`Aggiungi credenziale ${meta.title}`}
        >
          <option value="">Aggiungi da archivio…</option>
          {filtered
            .filter((c) => !ids.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={() => setInlineOpen((o) => !o)}>
          <Plus className="h-4 w-4 mr-1" />
          Nuova credenziale
        </Button>
      </div>
      {inlineOpen && (
        <div className="grid gap-2 pt-2 border-t border-border/60">
          <div className="space-y-1">
            <Label className="text-xs">Nome in archivio</Label>
            <Input value={inlineName} onChange={(e) => setInlineName(e.target.value)} placeholder="es. WinRM server" />
          </div>
          {role !== "snmp" && (
            <div className="space-y-1">
              <Label className="text-xs">Username</Label>
              <Input value={inlineUser} onChange={(e) => setInlineUser(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">{role === "snmp" ? "Community SNMP" : "Password"}</Label>
            <Input
              type="password"
              value={inlinePass}
              onChange={(e) => setInlinePass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button type="button" size="sm" disabled={inlineSaving} onClick={() => void createInline()}>
            {inlineSaving ? "Salvataggio…" : "Crea e aggiungi"}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface NetworkCredentialChainsProps {
  credentials: CredentialRow[];
  windowsIds: number[];
  linuxIds: number[];
  sshIds: number[];
  snmpIds: number[];
  onWindowsChange: (ids: number[]) => void;
  onLinuxChange: (ids: number[]) => void;
  onSshChange: (ids: number[]) => void;
  onSnmpChange: (ids: number[]) => void;
  onCredentialsRefresh: () => Promise<void>;
}

export function NetworkCredentialChains({
  credentials,
  windowsIds,
  linuxIds,
  sshIds,
  snmpIds,
  onWindowsChange,
  onLinuxChange,
  onSshChange,
  onSnmpChange,
  onCredentialsRefresh,
}: NetworkCredentialChainsProps) {
  const refresh = useCallback(async () => {
    await onCredentialsRefresh();
  }, [onCredentialsRefresh]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Preleva dall&apos;archivio o crea credenziali esplicite. L&apos;ordine in ogni elenco determina i tentativi (un accesso per credenziale).
      </p>

      <div className="rounded-lg border border-primary/25 bg-primary/5 dark:bg-primary/10 p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Rilevamento avanzato</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Le credenziali configurate qui sotto vengono usate <strong className="text-foreground font-medium">in sequenza</strong> dalle
            azioni di rilevamento sull&apos;host (prima WinRM per Windows, poi accesso SSH per sistemi Linux), per acquisire hostname, sistema
            operativo e altri dati fondamentali del dispositivo. Senza catene qui valgono le credenziali globali in Impostazioni, se presenti.
          </p>
        </div>
        <ChainSection
          role="windows"
          ids={windowsIds}
          onChange={onWindowsChange}
          credentials={credentials}
          onAfterCreateCredential={refresh}
        />
        <ChainSection
          role="linux"
          ids={linuxIds}
          onChange={onLinuxChange}
          credentials={credentials}
          onAfterCreateCredential={refresh}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">SSH dispositivi</strong> e <strong className="text-foreground">SNMP</strong> usano catene dedicate
        (enrichment su appliance e rete, non lo stesso flusso WinRM+Linux).
      </p>
      <ChainSection
        role="ssh"
        ids={sshIds}
        onChange={onSshChange}
        credentials={credentials}
        onAfterCreateCredential={refresh}
      />
      <ChainSection
        role="snmp"
        ids={snmpIds}
        onChange={onSnmpChange}
        credentials={credentials}
        onAfterCreateCredential={refresh}
      />
    </div>
  );
}
