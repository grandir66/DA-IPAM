"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Save,
  Download,
  Upload,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ClientConfig,
  ClienteData,
  AccessoData,
  VlanRow,
  SwitchRow,
  FirewallData,
  LineaRow,
  WifiData,
  VpnRow,
  StorageRow,
  AdData,
  ServerFisicoRow,
  VirtualizzazioneData,
  VmRow,
  PostaData,
  CentralinoData,
  SoftwaredomarcData,
  ServizioCloudRow,
  BackupData,
  GestionaleRow,
  ApparatiData,
} from "@/lib/client-config";

// ─────────────────────────────────────────────
// Default factories
// ─────────────────────────────────────────────

const emptyCliente = (): ClienteData => ({ cliente: "", referente: "", cod_cliente: "" });
const emptyAccesso = (): AccessoData => ({ rdp: [""], teamviewer: [""], vpn: [], bitwise: "" });
const emptyVlan = (): VlanRow => ({ id: "", subnet: "", gtw: "", dns: "", note: "" });
const emptySwitch = (): SwitchRow => ({ nome: "", ip: "", modello: "", credenziali: "", snmp: "", note: "" });
const emptyFirewall = (): FirewallData => ({ modello: "", sn: "", ip_interno: "", ip_esterno: "", credenziali: "", snmp: "", note: "" });
const emptyLinea = (): LineaRow => ({ nome: "", provider: "", ip_sub: "", ip_p2p: "", router: "", note: "" });
const emptyWifi = (): WifiData => ({ controller: "", controller_ip: "", controller_cred: "", aps: [""], ssids: [{ ssid: "", wpa: "" }], note: "" });
const emptyVpn = (): VpnRow => ({ nome: "", local_device: "", remote_device: "", local_ip: "", remote_ip: "", local_net: "", remote_net: "", ike: "", ipsec: "", note: "" });
const emptyStorage = (): StorageRow => ({ nome: "", modello: "", ip: "", credenziali: "", spazio: "", snmp: "", note: "" });
const emptyAd = (): AdData => ({ dominio_dns: "", dominio_netbios: "", credenziali: "", dns: "", dhcp: "", user_domarc: "", dc: "", note: "" });
const emptyServerFisico = (): ServerFisicoRow => ({ nome: "", modello: "", ip: "", ip_ilo: "", credenziali: "", snmp: "", note: "" });
const emptyVirtualizzazione = (): VirtualizzazioneData => ({ tipo: "vmware", vcenter_ver: "", vcenter_ip: "", vcenter_cred: "", vcenter_cred_5480: "", esx: [""] });
const emptyVm = (): VmRow => ({ nome: "", ip: "", funzioni: "", os: "", cpu: "", ram: "", dischi: "" });
const emptyPosta = (): PostaData => ({ locale: "", cloud_servizio: "", cloud_cred: "" });
const emptyCentralino = (): CentralinoData => ({ tipo: "", ip: "", credenziali: "", linee: "", telefoni: "" });
const emptySoftwareDomarc = (): SoftwaredomarcData => ({ antivirus: "", log_collector: "", datia: "", office365: "" });
const emptyServizioCloud = (): ServizioCloudRow => ({ nome: "", dettagli: "" });
const emptyBackup = (): BackupData => ({ locale: "", nas: "", cloud: "", software: "" });
const emptyGestionale = (): GestionaleRow => ({ nome: "", assistenza: "" });
const emptyApparati = (): ApparatiData => ({ ups: "", domotica: "", altri: "" });

function emptyConfig(): ClientConfig {
  return {
    cliente: emptyCliente(),
    accesso: emptyAccesso(),
    network: [emptyVlan()],
    switch: [emptySwitch()],
    firewall: emptyFirewall(),
    linee: [emptyLinea()],
  };
}

// ─────────────────────────────────────────────
// Accordion section wrapper
// ─────────────────────────────────────────────

function Section({
  title,
  open,
  onToggle,
  optional,
  enabled,
  onEnable,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  optional?: boolean;
  enabled?: boolean;
  onEnable?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none py-3"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          onToggle();
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {optional && onEnable && (
            <Button
              variant={enabled ? "default" : "outline"}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEnable(!enabled);
              }}
            >
              {enabled ? "Attiva" : "Disattiva"}
            </Button>
          )}
        </div>
      </CardHeader>
      {open && (!optional || enabled) && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─────────────────────────────────────────────
// Reusable field helpers
// ─────────────────────────────────────────────

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1" />
    </div>
  );
}

function AddRemoveRow({ onAdd, onRemove, canRemove }: {
  onAdd: () => void; onRemove: () => void; canRemove: boolean;
}) {
  return (
    <div className="flex gap-2 mt-2">
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
      </Button>
      {canRemove && (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="text-destructive">
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Rimuovi ultimo
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────

export default function ClientConfigPage() {
  const { data: session } = useSession();
  const tenantCode = (session?.user as { tenantCode?: string } | undefined)?.tenantCode ?? "";

  const [config, setConfig] = useState<ClientConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ cliente: true });

  // Sezioni opzionali abilitate
  const [optEnabled, setOptEnabled] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));
  const isOpen = (key: string) => !!openSections[key];

  const toggleOpt = (key: string, val: boolean) => {
    setOptEnabled((p) => ({ ...p, [key]: val }));
    if (val && !(config as unknown as Record<string, unknown>)[key]) {
      // Inizializza la sezione opzionale con valori vuoti
      const defaults: Record<string, unknown> = {
        wifi: emptyWifi(),
        vpn: [emptyVpn()],
        storage: [emptyStorage()],
        ad: emptyAd(),
        server_fisici: [emptyServerFisico()],
        virtualizzazione: emptyVirtualizzazione(),
        vm: [emptyVm()],
        posta: emptyPosta(),
        centralino: emptyCentralino(),
        software_domarc: emptySoftwareDomarc(),
        servizi_cloud: [emptyServizioCloud()],
        stampanti: [""],
        backup: emptyBackup(),
        gestionale: [emptyGestionale()],
        apparati: emptyApparati(),
        licenze: "",
      };
      setConfig((p) => ({ ...p, [key]: defaults[key] }));
    }
    if (!val) {
      setConfig((p) => {
        const copy = { ...p };
        delete (copy as unknown as Record<string, unknown>)[key];
        return copy;
      });
    }
  };

  // Caricamento iniziale
  const loadConfig = useCallback(async () => {
    if (!tenantCode || tenantCode === "__ALL__") {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/client-config?code=${encodeURIComponent(tenantCode)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.cliente) {
          setConfig(data);
          // Abilita sezioni opzionali presenti
          const optKeys = ["wifi", "vpn", "storage", "ad", "server_fisici", "virtualizzazione", "vm", "posta", "centralino", "software_domarc", "servizi_cloud", "stampanti", "backup", "gestionale", "apparati", "licenze"];
          const en: Record<string, boolean> = {};
          for (const k of optKeys) {
            if ((data as unknown as Record<string, unknown>)[k] !== undefined) en[k] = true;
          }
          setOptEnabled(en);
        }
      }
    } catch {
      // Nessuna config esistente
    } finally {
      setLoading(false);
    }
  }, [tenantCode]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Salvataggio
  const handleSave = async () => {
    if (!tenantCode || tenantCode === "__ALL__") {
      toast.error("Seleziona un tenant specifico");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/client-config?code=${encodeURIComponent(tenantCode)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast.success("Configurazione salvata (JSON + MD)");
      } else {
        const err = await res.json();
        toast.error(err.error ?? "Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSaving(false);
    }
  };

  // Export MD
  const handleExport = async () => {
    if (!tenantCode) return;
    try {
      const res = await fetch(`/api/client-config/export?code=${encodeURIComponent(tenantCode)}`);
      if (!res.ok) {
        toast.error("Nessuna configurazione da esportare");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tenantCode}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Errore nell'esportazione");
    }
  };

  // Import JSON
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let data: ClientConfig;
        try {
          data = JSON.parse(text);
        } catch {
          toast.error("File JSON non valido");
          return;
        }
        if (!data.cliente?.cliente) {
          toast.error("JSON non valido: manca il campo cliente");
          return;
        }
        const code = tenantCode || data.cliente.cod_cliente;
        if (!code) {
          toast.error("Codice cliente non determinabile");
          return;
        }
        const res = await fetch(`/api/client-config/import?code=${encodeURIComponent(code)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          toast.success("Configurazione importata");
          setConfig(data);
          // Abilita sezioni presenti
          const optKeys = ["wifi", "vpn", "storage", "ad", "server_fisici", "virtualizzazione", "vm", "posta", "centralino", "software_domarc", "servizi_cloud", "stampanti", "backup", "gestionale", "apparati", "licenze"];
          const en: Record<string, boolean> = {};
          for (const k of optKeys) {
            if ((data as unknown as Record<string, unknown>)[k] !== undefined) en[k] = true;
          }
          setOptEnabled(en);
        } else {
          const err = await res.json();
          toast.error(err.error ?? "Errore nell'importazione");
        }
      } catch {
        toast.error("Errore nella lettura del file");
      }
    };
    input.click();
  };

  // Updaters generici
  const updateCliente = (field: keyof ClienteData, val: string) =>
    setConfig((p) => ({ ...p, cliente: { ...p.cliente, [field]: val } }));

  const updateAccesso = (field: keyof AccessoData, val: AccessoData[keyof AccessoData]) =>
    setConfig((p) => ({ ...p, accesso: { ...p.accesso, [field]: val } }));

  const updateFirewall = (field: keyof FirewallData, val: string) =>
    setConfig((p) => ({ ...p, firewall: { ...p.firewall, [field]: val } }));

  function updateListItem<T>(key: string, index: number, field: keyof T, val: string) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as T[])];
      arr[index] = { ...arr[index], [field]: val };
      return { ...p, [key]: arr };
    });
  }

  function addListItem<T>(key: string, factory: () => T) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as T[]), factory()];
      return { ...p, [key]: arr };
    });
  }

  function removeLastItem(key: string) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as unknown[])];
      if (arr.length > 1) arr.pop();
      return { ...p, [key]: arr };
    });
  }

  // String-list updaters (per rdp, teamviewer, vpn accesso, aps, stampanti)
  function updateStringList(parentKey: string, field: string, index: number, val: string) {
    setConfig((p) => {
      const parent = { ...(p as unknown as Record<string, unknown>)[parentKey] as Record<string, unknown> };
      const arr = [...(parent[field] as string[])];
      arr[index] = val;
      parent[field] = arr;
      return { ...p, [parentKey]: parent };
    });
  }

  function addStringToList(parentKey: string, field: string) {
    setConfig((p) => {
      const parent = { ...(p as unknown as Record<string, unknown>)[parentKey] as Record<string, unknown> };
      const arr = [...(parent[field] as string[]), ""];
      parent[field] = arr;
      return { ...p, [parentKey]: parent };
    });
  }

  function removeLastString(parentKey: string, field: string) {
    setConfig((p) => {
      const parent = { ...(p as unknown as Record<string, unknown>)[parentKey] as Record<string, unknown> };
      const arr = [...(parent[field] as string[])];
      if (arr.length > 1) arr.pop();
      parent[field] = arr;
      return { ...p, [parentKey]: parent };
    });
  }

  // Top-level string list (stampanti)
  function updateTopStringList(key: string, index: number, val: string) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as string[])];
      arr[index] = val;
      return { ...p, [key]: arr };
    });
  }

  function addTopString(key: string) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as string[]), ""];
      return { ...p, [key]: arr };
    });
  }

  function removeLastTopString(key: string) {
    setConfig((p) => {
      const arr = [...((p as unknown as Record<string, unknown>)[key] as string[])];
      if (arr.length > 1) arr.pop();
      return { ...p, [key]: arr };
    });
  }

  // Opt section updater
  function updateOpt<T extends Record<string, unknown>>(key: string, field: string, val: unknown) {
    setConfig((p) => {
      const sec = { ...(p as unknown as Record<string, unknown>)[key] as T };
      (sec as unknown as Record<string, unknown>)[field] = val;
      return { ...p, [key]: sec };
    });
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Configurazione Cliente</h1>
        <p className="text-muted-foreground text-sm">Caricamento...</p>
      </div>
    );
  }

  if (tenantCode === "__ALL__") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Configurazione Cliente</h1>
        <p className="text-muted-foreground text-sm">Seleziona un tenant specifico dalla barra laterale per accedere alla configurazione.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Configurazione Cliente</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Scheda infrastrutturale — {tenantCode}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="h-4 w-4 mr-1" /> Importa JSON
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> Esporta MD
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Salvataggio..." : "Salva"}
          </Button>
        </div>
      </div>

      {/* ═══ SEZIONI OBBLIGATORIE ═══ */}

      {/* CLIENTE */}
      <Section title="Dati Cliente" open={isOpen("cliente")} onToggle={() => toggle("cliente")}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Nome cliente" value={config.cliente.cliente} onChange={(v) => updateCliente("cliente", v)} />
          <Field label="Referente/i tecnico" value={config.cliente.referente} onChange={(v) => updateCliente("referente", v)} />
          <Field label="Codice cliente" value={config.cliente.cod_cliente} onChange={(v) => updateCliente("cod_cliente", v)} />
        </div>
      </Section>

      {/* ACCESSO */}
      <Section title="Accesso Servizi Cliente" open={isOpen("accesso")} onToggle={() => toggle("accesso")}>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">RDP</Label>
            {config.accesso.rdp.map((r, i) => (
              <Input key={i} value={r} onChange={(e) => updateStringList("accesso", "rdp", i, e.target.value)} placeholder={`RDP ${i + 1}`} className="mt-1" />
            ))}
            <AddRemoveRow onAdd={() => addStringToList("accesso", "rdp")} onRemove={() => removeLastString("accesso", "rdp")} canRemove={config.accesso.rdp.length > 1} />
          </div>
          <div>
            <Label className="text-sm font-medium">TeamViewer</Label>
            {config.accesso.teamviewer.map((t, i) => (
              <Input key={i} value={t} onChange={(e) => updateStringList("accesso", "teamviewer", i, e.target.value)} placeholder={`TeamViewer ${i + 1}`} className="mt-1" />
            ))}
            <AddRemoveRow onAdd={() => addStringToList("accesso", "teamviewer")} onRemove={() => removeLastString("accesso", "teamviewer")} canRemove={config.accesso.teamviewer.length > 1} />
          </div>
          <div>
            <Label className="text-sm font-medium">VPN</Label>
            {config.accesso.vpn.map((v, i) => (
              <Input key={i} value={v} onChange={(e) => updateStringList("accesso", "vpn", i, e.target.value)} placeholder={`VPN ${i + 1}`} className="mt-1" />
            ))}
            <AddRemoveRow onAdd={() => addStringToList("accesso", "vpn")} onRemove={() => removeLastString("accesso", "vpn")} canRemove={config.accesso.vpn.length > 0} />
          </div>
          <Field label="Bitwise" value={config.accesso.bitwise} onChange={(v) => updateAccesso("bitwise", v)} />
        </div>
      </Section>

      {/* NETWORK */}
      <Section title="Network (VLAN)" open={isOpen("network")} onToggle={() => toggle("network")}>
        <div className="space-y-4">
          {config.network.map((row, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">VLAN {i + 1}</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field label="ID VLAN" value={row.id} onChange={(v) => updateListItem<VlanRow>("network", i, "id", v)} />
                <Field label="Subnet" value={row.subnet} onChange={(v) => updateListItem<VlanRow>("network", i, "subnet", v)} />
                <Field label="Gateway" value={row.gtw} onChange={(v) => updateListItem<VlanRow>("network", i, "gtw", v)} />
                <Field label="DNS" value={row.dns} onChange={(v) => updateListItem<VlanRow>("network", i, "dns", v)} />
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<VlanRow>("network", i, "note", v)} />
              </div>
            </div>
          ))}
          <AddRemoveRow onAdd={() => addListItem("network", emptyVlan)} onRemove={() => removeLastItem("network")} canRemove={config.network.length > 1} />
        </div>
      </Section>

      {/* SWITCH */}
      <Section title="Switch" open={isOpen("switch")} onToggle={() => toggle("switch")}>
        <div className="space-y-4">
          {config.switch.map((row, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Switch {i + 1}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<SwitchRow>("switch", i, "nome", v)} />
                <Field label="IP" value={row.ip} onChange={(v) => updateListItem<SwitchRow>("switch", i, "ip", v)} />
                <Field label="Modello" value={row.modello} onChange={(v) => updateListItem<SwitchRow>("switch", i, "modello", v)} />
                <Field label="Credenziali" value={row.credenziali} onChange={(v) => updateListItem<SwitchRow>("switch", i, "credenziali", v)} />
                <Field label="SNMP" value={row.snmp} onChange={(v) => updateListItem<SwitchRow>("switch", i, "snmp", v)} />
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<SwitchRow>("switch", i, "note", v)} />
              </div>
            </div>
          ))}
          <AddRemoveRow onAdd={() => addListItem("switch", emptySwitch)} onRemove={() => removeLastItem("switch")} canRemove={config.switch.length > 1} />
        </div>
      </Section>

      {/* FIREWALL */}
      <Section title="Firewall" open={isOpen("firewall")} onToggle={() => toggle("firewall")}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Modello" value={config.firewall.modello} onChange={(v) => updateFirewall("modello", v)} />
          <Field label="Serial Number" value={config.firewall.sn} onChange={(v) => updateFirewall("sn", v)} />
          <Field label="IP Interno" value={config.firewall.ip_interno} onChange={(v) => updateFirewall("ip_interno", v)} />
          <Field label="IP Esterno" value={config.firewall.ip_esterno} onChange={(v) => updateFirewall("ip_esterno", v)} />
          <Field label="Credenziali" value={config.firewall.credenziali} onChange={(v) => updateFirewall("credenziali", v)} />
          <Field label="SNMP" value={config.firewall.snmp} onChange={(v) => updateFirewall("snmp", v)} />
        </div>
        <div className="mt-3">
          <Field label="Note" value={config.firewall.note} onChange={(v) => updateFirewall("note", v)} />
        </div>
      </Section>

      {/* LINEE DATI */}
      <Section title="Linee Dati" open={isOpen("linee")} onToggle={() => toggle("linee")}>
        <div className="space-y-4">
          {config.linee.map((row, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Linea {i + 1}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<LineaRow>("linee", i, "nome", v)} />
                <Field label="Provider" value={row.provider} onChange={(v) => updateListItem<LineaRow>("linee", i, "provider", v)} />
                <Field label="IP/Subnet" value={row.ip_sub} onChange={(v) => updateListItem<LineaRow>("linee", i, "ip_sub", v)} />
                <Field label="IP p2p" value={row.ip_p2p} onChange={(v) => updateListItem<LineaRow>("linee", i, "ip_p2p", v)} />
                <Field label="Router" value={row.router} onChange={(v) => updateListItem<LineaRow>("linee", i, "router", v)} />
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<LineaRow>("linee", i, "note", v)} />
              </div>
            </div>
          ))}
          <AddRemoveRow onAdd={() => addListItem("linee", emptyLinea)} onRemove={() => removeLastItem("linee")} canRemove={config.linee.length > 1} />
        </div>
      </Section>

      {/* ═══ SEPARATORE SEZIONI OPZIONALI ═══ */}
      <div className="border-t pt-4">
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sezioni Opzionali</p>
      </div>

      {/* WIFI */}
      <Section title="WiFi" open={isOpen("wifi")} onToggle={() => toggle("wifi")} optional enabled={!!optEnabled.wifi} onEnable={(v) => toggleOpt("wifi", v)}>
        {config.wifi && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Controller" value={config.wifi.controller} onChange={(v) => updateOpt("wifi", "controller", v)} />
              <Field label="IP Controller" value={config.wifi.controller_ip} onChange={(v) => updateOpt("wifi", "controller_ip", v)} />
              <Field label="Credenziali Controller" value={config.wifi.controller_cred} onChange={(v) => updateOpt("wifi", "controller_cred", v)} />
            </div>
            <div>
              <Label className="text-sm font-medium">Access Point</Label>
              {config.wifi.aps.map((ap, i) => (
                <Input key={i} value={ap} onChange={(e) => {
                  const aps = [...config.wifi!.aps];
                  aps[i] = e.target.value;
                  updateOpt("wifi", "aps", aps);
                }} placeholder={`AP ${i + 1}`} className="mt-1" />
              ))}
              <AddRemoveRow
                onAdd={() => updateOpt("wifi", "aps", [...config.wifi!.aps, ""])}
                onRemove={() => updateOpt("wifi", "aps", config.wifi!.aps.slice(0, -1))}
                canRemove={config.wifi.aps.length > 1}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">SSID</Label>
              {config.wifi.ssids.map((s, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 mt-1">
                  <Input value={s.ssid} onChange={(e) => {
                    const ssids = [...config.wifi!.ssids];
                    ssids[i] = { ...ssids[i], ssid: e.target.value };
                    updateOpt("wifi", "ssids", ssids);
                  }} placeholder="Nome SSID" />
                  <Input value={s.wpa} onChange={(e) => {
                    const ssids = [...config.wifi!.ssids];
                    ssids[i] = { ...ssids[i], wpa: e.target.value };
                    updateOpt("wifi", "ssids", ssids);
                  }} placeholder="WPA Key" />
                </div>
              ))}
              <AddRemoveRow
                onAdd={() => updateOpt("wifi", "ssids", [...config.wifi!.ssids, { ssid: "", wpa: "" }])}
                onRemove={() => updateOpt("wifi", "ssids", config.wifi!.ssids.slice(0, -1))}
                canRemove={config.wifi.ssids.length > 1}
              />
            </div>
            <Field label="Note" value={config.wifi.note} onChange={(v) => updateOpt("wifi", "note", v)} />
          </div>
        )}
      </Section>

      {/* VPN */}
      <Section title="VPN" open={isOpen("vpn")} onToggle={() => toggle("vpn")} optional enabled={!!optEnabled.vpn} onEnable={(v) => toggleOpt("vpn", v)}>
        {config.vpn && (
          <div className="space-y-4">
            {config.vpn.map((row, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Tunnel VPN {i + 1}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<VpnRow>("vpn", i, "nome", v)} />
                  <Field label="Local Device" value={row.local_device} onChange={(v) => updateListItem<VpnRow>("vpn", i, "local_device", v)} />
                  <Field label="Remote Device" value={row.remote_device} onChange={(v) => updateListItem<VpnRow>("vpn", i, "remote_device", v)} />
                  <Field label="Local IP" value={row.local_ip} onChange={(v) => updateListItem<VpnRow>("vpn", i, "local_ip", v)} />
                  <Field label="Remote IP" value={row.remote_ip} onChange={(v) => updateListItem<VpnRow>("vpn", i, "remote_ip", v)} />
                  <Field label="Local Network" value={row.local_net} onChange={(v) => updateListItem<VpnRow>("vpn", i, "local_net", v)} />
                  <Field label="Remote Network" value={row.remote_net} onChange={(v) => updateListItem<VpnRow>("vpn", i, "remote_net", v)} />
                  <Field label="IKE parameters" value={row.ike} onChange={(v) => updateListItem<VpnRow>("vpn", i, "ike", v)} />
                  <Field label="IPSEC parameters" value={row.ipsec} onChange={(v) => updateListItem<VpnRow>("vpn", i, "ipsec", v)} />
                </div>
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<VpnRow>("vpn", i, "note", v)} />
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("vpn", emptyVpn)} onRemove={() => removeLastItem("vpn")} canRemove={config.vpn.length > 1} />
          </div>
        )}
      </Section>

      {/* STORAGE */}
      <Section title="Storage (NAS)" open={isOpen("storage")} onToggle={() => toggle("storage")} optional enabled={!!optEnabled.storage} onEnable={(v) => toggleOpt("storage", v)}>
        {config.storage && (
          <div className="space-y-4">
            {config.storage.map((row, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">NAS {i + 1}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<StorageRow>("storage", i, "nome", v)} />
                  <Field label="Modello" value={row.modello} onChange={(v) => updateListItem<StorageRow>("storage", i, "modello", v)} />
                  <Field label="IP" value={row.ip} onChange={(v) => updateListItem<StorageRow>("storage", i, "ip", v)} />
                  <Field label="Credenziali" value={row.credenziali} onChange={(v) => updateListItem<StorageRow>("storage", i, "credenziali", v)} />
                  <Field label="Spazio totale" value={row.spazio} onChange={(v) => updateListItem<StorageRow>("storage", i, "spazio", v)} />
                  <Field label="SNMP" value={row.snmp} onChange={(v) => updateListItem<StorageRow>("storage", i, "snmp", v)} />
                </div>
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<StorageRow>("storage", i, "note", v)} />
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("storage", emptyStorage)} onRemove={() => removeLastItem("storage")} canRemove={config.storage.length > 1} />
          </div>
        )}
      </Section>

      {/* AD */}
      <Section title="Active Directory" open={isOpen("ad")} onToggle={() => toggle("ad")} optional enabled={!!optEnabled.ad} onEnable={(v) => toggleOpt("ad", v)}>
        {config.ad && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Dominio DNS (FQDN)" value={config.ad.dominio_dns} onChange={(v) => updateOpt("ad", "dominio_dns", v)} />
            <Field label="Dominio NETBIOS" value={config.ad.dominio_netbios} onChange={(v) => updateOpt("ad", "dominio_netbios", v)} />
            <Field label="Credenziali" value={config.ad.credenziali} onChange={(v) => updateOpt("ad", "credenziali", v)} />
            <Field label="DNS" value={config.ad.dns} onChange={(v) => updateOpt("ad", "dns", v)} />
            <Field label="DHCP" value={config.ad.dhcp} onChange={(v) => updateOpt("ad", "dhcp", v)} />
            <Field label="User DOMARC" value={config.ad.user_domarc} onChange={(v) => updateOpt("ad", "user_domarc", v)} />
            <Field label="Domain Controller" value={config.ad.dc} onChange={(v) => updateOpt("ad", "dc", v)} />
            <Field label="Note" value={config.ad.note} onChange={(v) => updateOpt("ad", "note", v)} />
          </div>
        )}
      </Section>

      {/* SERVER FISICI */}
      <Section title="Server Fisici" open={isOpen("server_fisici")} onToggle={() => toggle("server_fisici")} optional enabled={!!optEnabled.server_fisici} onEnable={(v) => toggleOpt("server_fisici", v)}>
        {config.server_fisici && (
          <div className="space-y-4">
            {config.server_fisici.map((row, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Server {i + 1}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "nome", v)} />
                  <Field label="Modello" value={row.modello} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "modello", v)} />
                  <Field label="IP" value={row.ip} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "ip", v)} />
                  <Field label="IP iLO/IPMI" value={row.ip_ilo} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "ip_ilo", v)} />
                  <Field label="Credenziali" value={row.credenziali} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "credenziali", v)} />
                  <Field label="SNMP" value={row.snmp} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "snmp", v)} />
                </div>
                <Field label="Note" value={row.note} onChange={(v) => updateListItem<ServerFisicoRow>("server_fisici", i, "note", v)} />
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("server_fisici", emptyServerFisico)} onRemove={() => removeLastItem("server_fisici")} canRemove={config.server_fisici.length > 1} />
          </div>
        )}
      </Section>

      {/* VIRTUALIZZAZIONE */}
      <Section title="Virtualizzazione" open={isOpen("virtualizzazione")} onToggle={() => toggle("virtualizzazione")} optional enabled={!!optEnabled.virtualizzazione} onEnable={(v) => toggleOpt("virtualizzazione", v)}>
        {config.virtualizzazione && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Label className="text-sm">Piattaforma</Label>
              <Select value={config.virtualizzazione.tipo} onValueChange={(v) => updateOpt("virtualizzazione", "tipo", v)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vmware">VMware</SelectItem>
                  <SelectItem value="proxmox">Proxmox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {config.virtualizzazione.tipo === "vmware" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Versione vCenter" value={config.virtualizzazione.vcenter_ver ?? ""} onChange={(v) => updateOpt("virtualizzazione", "vcenter_ver", v)} />
                  <Field label="IP vCenter" value={config.virtualizzazione.vcenter_ip ?? ""} onChange={(v) => updateOpt("virtualizzazione", "vcenter_ip", v)} />
                  <Field label="Credenziali vCenter" value={config.virtualizzazione.vcenter_cred ?? ""} onChange={(v) => updateOpt("virtualizzazione", "vcenter_cred", v)} />
                  <Field label="Credenziali vCenter (5480)" value={config.virtualizzazione.vcenter_cred_5480 ?? ""} onChange={(v) => updateOpt("virtualizzazione", "vcenter_cred_5480", v)} />
                </div>
                <div>
                  <Label className="text-sm font-medium">ESX Hosts</Label>
                  {(config.virtualizzazione.esx ?? [""]).map((esx, i) => (
                    <Input key={i} value={esx} onChange={(e) => {
                      const arr = [...(config.virtualizzazione!.esx ?? [""])];
                      arr[i] = e.target.value;
                      updateOpt("virtualizzazione", "esx", arr);
                    }} placeholder={`ESX ${i + 1}`} className="mt-1" />
                  ))}
                  <AddRemoveRow
                    onAdd={() => updateOpt("virtualizzazione", "esx", [...(config.virtualizzazione!.esx ?? []), ""])}
                    onRemove={() => updateOpt("virtualizzazione", "esx", (config.virtualizzazione!.esx ?? []).slice(0, -1))}
                    canRemove={(config.virtualizzazione.esx ?? []).length > 1}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Versione PVE" value={config.virtualizzazione.versione ?? ""} onChange={(v) => updateOpt("virtualizzazione", "versione", v)} />
                  <Field label="Nome cluster" value={config.virtualizzazione.cluster ?? ""} onChange={(v) => updateOpt("virtualizzazione", "cluster", v)} placeholder="Vuoto = standalone" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Nodi</Label>
                  {(config.virtualizzazione.nodi ?? [{ nome: "", ip: "", credenziali: "" }]).map((nd, i) => (
                    <div key={i} className="grid grid-cols-3 gap-3 mt-1">
                      <Input value={nd.nome} onChange={(e) => {
                        const nodi = [...(config.virtualizzazione!.nodi ?? [])];
                        nodi[i] = { ...nodi[i], nome: e.target.value };
                        updateOpt("virtualizzazione", "nodi", nodi);
                      }} placeholder="Nome nodo" />
                      <Input value={nd.ip} onChange={(e) => {
                        const nodi = [...(config.virtualizzazione!.nodi ?? [])];
                        nodi[i] = { ...nodi[i], ip: e.target.value };
                        updateOpt("virtualizzazione", "nodi", nodi);
                      }} placeholder="IP" />
                      <Input value={nd.credenziali} onChange={(e) => {
                        const nodi = [...(config.virtualizzazione!.nodi ?? [])];
                        nodi[i] = { ...nodi[i], credenziali: e.target.value };
                        updateOpt("virtualizzazione", "nodi", nodi);
                      }} placeholder="Credenziali" />
                    </div>
                  ))}
                  <AddRemoveRow
                    onAdd={() => updateOpt("virtualizzazione", "nodi", [...(config.virtualizzazione!.nodi ?? []), { nome: "", ip: "", credenziali: "" }])}
                    onRemove={() => updateOpt("virtualizzazione", "nodi", (config.virtualizzazione!.nodi ?? []).slice(0, -1))}
                    canRemove={(config.virtualizzazione.nodi ?? []).length > 1}
                  />
                </div>
                <Field label="Note" value={config.virtualizzazione.note ?? ""} onChange={(v) => updateOpt("virtualizzazione", "note", v)} />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* VM */}
      <Section title="VM" open={isOpen("vm")} onToggle={() => toggle("vm")} optional enabled={!!optEnabled.vm} onEnable={(v) => toggleOpt("vm", v)}>
        {config.vm && (
          <div className="space-y-4">
            {config.vm.map((row, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">VM {i + 1}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Nome" value={row.nome} onChange={(v) => updateListItem<VmRow>("vm", i, "nome", v)} />
                  <Field label="IP" value={row.ip} onChange={(v) => updateListItem<VmRow>("vm", i, "ip", v)} />
                  <Field label="Funzioni" value={row.funzioni} onChange={(v) => updateListItem<VmRow>("vm", i, "funzioni", v)} />
                  <Field label="OS" value={row.os} onChange={(v) => updateListItem<VmRow>("vm", i, "os", v)} />
                  <Field label="CPU" value={row.cpu} onChange={(v) => updateListItem<VmRow>("vm", i, "cpu", v)} />
                  <Field label="RAM (GB)" value={row.ram} onChange={(v) => updateListItem<VmRow>("vm", i, "ram", v)} />
                  <Field label="Dischi" value={row.dischi} onChange={(v) => updateListItem<VmRow>("vm", i, "dischi", v)} />
                </div>
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("vm", emptyVm)} onRemove={() => removeLastItem("vm")} canRemove={config.vm.length > 1} />
          </div>
        )}
      </Section>

      {/* POSTA */}
      <Section title="Posta" open={isOpen("posta")} onToggle={() => toggle("posta")} optional enabled={!!optEnabled.posta} onEnable={(v) => toggleOpt("posta", v)}>
        {config.posta && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Posta locale" value={config.posta.locale} onChange={(v) => updateOpt("posta", "locale", v)} />
            <Field label="Cloud - Servizio" value={config.posta.cloud_servizio} onChange={(v) => updateOpt("posta", "cloud_servizio", v)} />
            <Field label="Cloud - Sito e Credenziali" value={config.posta.cloud_cred} onChange={(v) => updateOpt("posta", "cloud_cred", v)} />
          </div>
        )}
      </Section>

      {/* CENTRALINO */}
      <Section title="Centralino" open={isOpen("centralino")} onToggle={() => toggle("centralino")} optional enabled={!!optEnabled.centralino} onEnable={(v) => toggleOpt("centralino", v)}>
        {config.centralino && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Tipo" value={config.centralino.tipo} onChange={(v) => updateOpt("centralino", "tipo", v)} />
            <Field label="IP" value={config.centralino.ip} onChange={(v) => updateOpt("centralino", "ip", v)} />
            <Field label="Credenziali" value={config.centralino.credenziali} onChange={(v) => updateOpt("centralino", "credenziali", v)} />
            <Field label="Linee" value={config.centralino.linee} onChange={(v) => updateOpt("centralino", "linee", v)} />
            <Field label="Telefoni" value={config.centralino.telefoni} onChange={(v) => updateOpt("centralino", "telefoni", v)} />
          </div>
        )}
      </Section>

      {/* SOFTWARE DOMARC */}
      <Section title="Software Domarc" open={isOpen("software_domarc")} onToggle={() => toggle("software_domarc")} optional enabled={!!optEnabled.software_domarc} onEnable={(v) => toggleOpt("software_domarc", v)}>
        {config.software_domarc && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Antivirus" value={config.software_domarc.antivirus} onChange={(v) => updateOpt("software_domarc", "antivirus", v)} />
            <Field label="Log Collector" value={config.software_domarc.log_collector} onChange={(v) => updateOpt("software_domarc", "log_collector", v)} />
            <Field label="DATIA Monitor" value={config.software_domarc.datia} onChange={(v) => updateOpt("software_domarc", "datia", v)} />
            <Field label="Office 365" value={config.software_domarc.office365} onChange={(v) => updateOpt("software_domarc", "office365", v)} />
          </div>
        )}
      </Section>

      {/* SERVIZI CLOUD */}
      <Section title="Servizi Cloud" open={isOpen("servizi_cloud")} onToggle={() => toggle("servizi_cloud")} optional enabled={!!optEnabled.servizi_cloud} onEnable={(v) => toggleOpt("servizi_cloud", v)}>
        {config.servizi_cloud && (
          <div className="space-y-4">
            {config.servizi_cloud.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-3">
                <Field label="Nome servizio" value={row.nome} onChange={(v) => updateListItem<ServizioCloudRow>("servizi_cloud", i, "nome", v)} />
                <Field label="Accesso, credenziali e note" value={row.dettagli} onChange={(v) => updateListItem<ServizioCloudRow>("servizi_cloud", i, "dettagli", v)} />
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("servizi_cloud", emptyServizioCloud)} onRemove={() => removeLastItem("servizi_cloud")} canRemove={config.servizi_cloud.length > 1} />
          </div>
        )}
      </Section>

      {/* STAMPANTI */}
      <Section title="Stampanti" open={isOpen("stampanti")} onToggle={() => toggle("stampanti")} optional enabled={!!optEnabled.stampanti} onEnable={(v) => toggleOpt("stampanti", v)}>
        {config.stampanti && (
          <div className="space-y-2">
            {config.stampanti.map((s, i) => (
              <Input key={i} value={s} onChange={(e) => updateTopStringList("stampanti", i, e.target.value)} placeholder={`Stampante ${i + 1} (nome/IP/modello)`} />
            ))}
            <AddRemoveRow onAdd={() => addTopString("stampanti")} onRemove={() => removeLastTopString("stampanti")} canRemove={config.stampanti.length > 1} />
          </div>
        )}
      </Section>

      {/* BACKUP */}
      <Section title="Backup" open={isOpen("backup")} onToggle={() => toggle("backup")} optional enabled={!!optEnabled.backup} onEnable={(v) => toggleOpt("backup", v)}>
        {config.backup && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Backup locale" value={config.backup.locale} onChange={(v) => updateOpt("backup", "locale", v)} />
            <Field label="Backup NAS" value={config.backup.nas} onChange={(v) => updateOpt("backup", "nas", v)} />
            <Field label="Backup Cloud" value={config.backup.cloud} onChange={(v) => updateOpt("backup", "cloud", v)} />
            <Field label="Software" value={config.backup.software} onChange={(v) => updateOpt("backup", "software", v)} placeholder="Es. VEEAM FREE, CLOUDBERRY" />
          </div>
        )}
      </Section>

      {/* GESTIONALE */}
      <Section title="Gestionale / Software" open={isOpen("gestionale")} onToggle={() => toggle("gestionale")} optional enabled={!!optEnabled.gestionale} onEnable={(v) => toggleOpt("gestionale", v)}>
        {config.gestionale && (
          <div className="space-y-4">
            {config.gestionale.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-3">
                <Field label="Nome software" value={row.nome} onChange={(v) => updateListItem<GestionaleRow>("gestionale", i, "nome", v)} />
                <Field label="Riferimenti assistenza" value={row.assistenza} onChange={(v) => updateListItem<GestionaleRow>("gestionale", i, "assistenza", v)} />
              </div>
            ))}
            <AddRemoveRow onAdd={() => addListItem("gestionale", emptyGestionale)} onRemove={() => removeLastItem("gestionale")} canRemove={config.gestionale.length > 1} />
          </div>
        )}
      </Section>

      {/* APPARATI AGGIUNTIVI */}
      <Section title="Apparati Aggiuntivi" open={isOpen("apparati")} onToggle={() => toggle("apparati")} optional enabled={!!optEnabled.apparati} onEnable={(v) => toggleOpt("apparati", v)}>
        {config.apparati && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="UPS" value={config.apparati.ups} onChange={(v) => updateOpt("apparati", "ups", v)} />
            <Field label="Domotica" value={config.apparati.domotica} onChange={(v) => updateOpt("apparati", "domotica", v)} />
            <Field label="Altri" value={config.apparati.altri} onChange={(v) => updateOpt("apparati", "altri", v)} />
          </div>
        )}
      </Section>

      {/* LICENZE */}
      <Section title="Gestione Licenze" open={isOpen("licenze")} onToggle={() => toggle("licenze")} optional enabled={!!optEnabled.licenze} onEnable={(v) => toggleOpt("licenze", v)}>
        {optEnabled.licenze && (
          <Textarea
            rows={6}
            value={config.licenze ?? ""}
            onChange={(e) => setConfig((p) => ({ ...p, licenze: e.target.value }))}
            placeholder="Note sulle licenze gestite per conto del cliente..."
          />
        )}
      </Section>

      {/* Footer save */}
      <div className="flex justify-end pt-2 pb-8">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? "Salvataggio..." : "Salva configurazione"}
        </Button>
      </div>
    </div>
  );
}
