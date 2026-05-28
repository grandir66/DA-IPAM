"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  KeyRound,
  Plus,
  ExternalLink,
  Eye,
  EyeOff,
  Copy,
  Pencil,
  Trash2,
  Shield,
  Server,
  Activity,
  Radar,
  Cloud,
  Wifi,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings as SettingsIcon,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CredentialKind, SystemCredential } from "@/lib/credentials-vault";

/**
 * Mappa kind+label → URL della pagina di configurazione corrispondente.
 * Le integrazioni Docker (Wazuh, LibreNMS, Graylog, Scanner-Edge, Loki) vivono
 * tutte sotto /settings?tab=integrazioni#int-<anchor>. Il Hub URL pubblico
 * (usato per enrollment agenti) vive invece in /agents#hub-url-config.
 *
 * Ritorna l'URL completo (deep-link diretto) oppure null se la entry vault è
 * "stand-alone" (nessuna pagina di config dedicata — usato come hint testuale
 * via getCredentialUsageHint).
 */
function getIntegrationConfigHref(item: SystemCredential): string | null {
  const label = item.label.toLowerCase();
  switch (item.kind) {
    case "wazuh": return "/settings?tab=integrazioni#int-wazuh";
    case "librenms": return "/settings?tab=integrazioni#int-librenms";
    case "graylog": return "/settings?tab=integrazioni#int-graylog";
    case "edge": return "/settings?tab=integrazioni#int-edge";
    case "hub": return "/agents#hub-url-config";
    case "other":
      if (label.includes("loki")) return "/settings?tab=integrazioni#int-loki";
      return null;
    default:
      return null;
  }
}

/**
 * Per i kind senza pagina di config (Tailscale, Proxmox, TrueNAS, "other" non-Loki)
 * ritorna una breve descrizione di dove la credenziale viene usata in DA-IPAM.
 * Aiuta l'utente a capire cosa farà la credenziale prima di salvarla.
 */
function getCredentialUsageHint(item: SystemCredential): string | null {
  switch (item.kind) {
    case "tailscale":
      return "Tailscale auth key — usato dal wizard nuovo agente per join automatico VPN. Nessuna pagina config: la credenziale viene letta solo al momento dell'enrollment.";
    case "pve":
      return "Proxmox API — letto da /devices durante match per-device (Proxmox-targets). Nessuna pagina config centralizzata.";
    case "truenas":
      return "TrueNAS target — riservato a backup remoti futuri. Oggi solo storage del secret, integrazione non ancora attiva.";
    case "other":
      return "Credenziale generica — usata da script/integrazioni custom. Nessuna pagina config standard.";
    default:
      return null;
  }
}

/** Una entry vault è "incompleta" quando non può completare un test di
 *  connessione: manca URL oppure mancano sia password che api_token. */
function isCredentialIncomplete(item: SystemCredential): boolean {
  if (!item.url && !item.api_url) return true;
  if (!item.has_password && !item.has_api_token) return true;
  return false;
}

const KIND_META: Record<CredentialKind, { icon: typeof Shield; label: string; color: string }> = {
  wazuh: { icon: Shield, label: "Wazuh", color: "text-blue-600" },
  graylog: { icon: Activity, label: "Graylog", color: "text-amber-600" },
  librenms: { icon: Server, label: "LibreNMS", color: "text-emerald-600" },
  truenas: { icon: HardDrive, label: "TrueNAS (backup)", color: "text-rose-600" },
  edge: { icon: Radar, label: "Scanner-Edge", color: "text-purple-600" },
  hub: { icon: Cloud, label: "DA-Vul-can Hub", color: "text-cyan-600" },
  tailscale: { icon: Wifi, label: "Tailscale", color: "text-indigo-600" },
  pve: { icon: Server, label: "Proxmox", color: "text-orange-600" },
  other: { icon: KeyRound, label: "Altro", color: "text-gray-600" },
};

interface RevealedSecrets {
  password: string | null;
  api_token: string | null;
  extra: Record<string, string> | null;
}

interface EditFormState {
  id?: number;
  kind: CredentialKind;
  label: string;
  url: string;
  api_url: string;
  username: string;
  password: string;
  api_token: string;
  notes: string;
}

const EMPTY_FORM: EditFormState = {
  kind: "other",
  label: "",
  url: "",
  api_url: "",
  username: "",
  password: "",
  api_token: "",
  notes: "",
};

interface LaunchpadClientProps {
  initialItems: SystemCredential[];
  /** Quando true, nasconde l'header pagina (titolo + descrizione) per embed
   *  dentro un'altra pagina (es. /settings?tab=integrazioni). I bottoni
   *  Importa/Dedup/Aggiungi restano per gli admin. */
  embedded?: boolean;
}

export function LaunchpadClient({ initialItems, embedded = false }: LaunchpadClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = ["admin", "superadmin"].includes(
    ((session?.user as { role?: string } | undefined)?.role ?? ""),
  );

  const [items, setItems] = useState<SystemCredential[]>(initialItems);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, RevealedSecrets | undefined>>({});
  const [showInternal, setShowInternal] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, "ok" | "fail">>({});

  // Detection "API interna" su 2 livelli:
  //  - label che contiene "(API interna)"
  //  - URL con hostname/porta NON browser-friendly:
  //      hostname container-only (librenms, graylog, loki, host.docker.internal)
  //      IP rete privata appliance (10.255.255.x)
  //      port API-only (55000 Wazuh Manager, 9200 OpenSearch, 9390/9392 Greenbone GMP)
  // Nascoste di default; toggle per esporle quando servono per debug/curl.
  const isApiOnlyUrl = (url: string | null): boolean => {
    if (!url) return false;
    if (/^(https?:\/\/)?(librenms|graylog|loki|host\.docker\.internal|10\.255\.255\.|172\.|appliance-)/.test(url)) {
      return true;
    }
    const m = url.match(/:(\d+)(\/|$)/);
    if (m) {
      const port = parseInt(m[1], 10);
      if ([55000, 9200, 3001, 9390, 9392].includes(port)) return true;
    }
    return false;
  };
  const isInternalItem = (i: SystemCredential): boolean =>
    /\(API interna\)/.test(i.label) || isApiOnlyUrl(i.url);

  const internalCount = items.filter(isInternalItem).length;
  const visibleItems = showInternal ? items : items.filter((i) => !isInternalItem(i));

  async function refresh() {
    const res = await fetch("/api/system-credentials");
    if (res.ok) {
      const data: { items: SystemCredential[] } = await res.json();
      setItems(data.items);
      router.refresh();
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await fetch("/api/system-credentials/sync", { method: "POST" });
      const data: { created: number; skipped: number; error?: string } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore sync");
        return;
      }
      toast.success(`Importate ${data.created} credenziali (${data.skipped} già presenti)`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDedup() {
    if (!confirm("Cerca entry duplicate (stesso kind+label o stesso kind+URL host) e tiene solo la migliore. Eliminazioni loggate in audit. Procedere?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/system-credentials/dedup", { method: "POST" });
      const data: { deleted: number; groups_with_duplicates: number; error?: string } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore dedup");
        return;
      }
      if (data.deleted === 0) {
        toast.info("Nessun duplicato trovato");
      } else {
        toast.success(`Eliminati ${data.deleted} duplicati in ${data.groups_with_duplicates} gruppi`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditOpen(true);
  }

  function openEdit(item: SystemCredential) {
    setForm({
      id: item.id,
      kind: item.kind,
      label: item.label,
      url: item.url ?? "",
      api_url: item.api_url ?? "",
      username: item.username ?? "",
      password: "",        // mai pre-popolato; admin fa reveal se serve modificarlo
      api_token: "",
      notes: item.notes ?? "",
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!form.label.trim()) {
      toast.error("Label obbligatoria");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        kind: form.kind,
        label: form.label.trim(),
        url: form.url.trim() || null,
        api_url: form.api_url.trim() || null,
        username: form.username.trim() || null,
        notes: form.notes.trim() || null,
      };
      // Secret: invia solo se l'admin ha digitato qualcosa. Stringa vuota = NON cambiare.
      if (form.password.trim()) payload.password = form.password;
      if (form.api_token.trim()) payload.api_token = form.api_token;

      const isUpdate = form.id !== undefined;
      const res = await fetch(
        isUpdate ? `/api/system-credentials/${form.id}` : "/api/system-credentials",
        {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data: { error?: string } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore");
        return;
      }
      toast.success(isUpdate ? "Aggiornato" : "Creato");
      setEditOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSeedDefaults() {
    setBusy(true);
    try {
      const res = await fetch("/api/system-credentials/seed-defaults", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`Placeholder creati: ${data.created} (skipped ${data.skipped})`, {
        description: "Compila URL e password tramite Modifica per attivarle.",
      });
      // Refresh page items
      const list = await fetch("/api/system-credentials").then((r) => r.json());
      setItems(list.items ?? list);
    } catch (e) {
      toast.error("Errore seed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(item: SystemCredential) {
    setTesting(item.id);
    try {
      const res = await fetch(`/api/system-credentials/${item.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      const ok = !!data.ok;
      setTestResults((m) => ({ ...m, [item.id]: ok ? "ok" : "fail" }));
      if (ok) {
        toast.success(`${item.label}: ok`, {
          description: `${data.http_status} · ${data.latency_ms}ms`,
        });
      } else {
        toast.error(`${item.label}: errore`, {
          description: data.error || `HTTP ${data.http_status}`,
        });
      }
    } catch (e) {
      setTestResults((m) => ({ ...m, [item.id]: "fail" }));
      toast.error(`${item.label}: ${(e as Error).message}`);
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete(item: SystemCredential) {
    if (!confirm(`Eliminare "${item.label}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/system-credentials/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Errore eliminazione");
        return;
      }
      toast.success("Eliminato");
      // Pulisci eventuali secret rivelati per quell'id
      setRevealed((s) => {
        const next = { ...s };
        delete next[item.id];
        return next;
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal(item: SystemCredential) {
    if (revealed[item.id]) {
      // toggle off
      setRevealed((s) => {
        const next = { ...s };
        delete next[item.id];
        return next;
      });
      return;
    }
    const res = await fetch(`/api/system-credentials/${item.id}/reveal`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Errore reveal");
      return;
    }
    setRevealed((s) => ({ ...s, [item.id]: data }));
    toast.info(`Reveal "${item.label}" — loggato in audit`);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiato`);
    } catch {
      toast.error("Errore copia clipboard");
    }
  }

  return (
    <div className={embedded ? "space-y-4" : "space-y-6 p-6"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <KeyRound className="h-6 w-6" />
              Launchpad
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Entry point unificato per accesso ai sistemi della stack security.
              Le credenziali sono cifrate (AES-GCM) in DA-IPAM. Ogni reveal è loggato.
            </p>
          </div>
        )}
        {embedded && (
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Accessi & credenziali (vault cifrato)
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Vault AES-GCM con URL, user, password/token e test connessione.
              Reveal loggato in audit. Solo admin può modificare.
            </p>
          </div>
        )}
        {isAdmin && (
          <div className="flex gap-2 items-center">
            {internalCount > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none border rounded px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={showInternal}
                  onChange={(e) => setShowInternal(e.target.checked)}
                  className="h-3 w-3"
                />
                Mostra API interne ({internalCount})
              </label>
            )}
            <Button variant="outline" onClick={handleSync} disabled={busy}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Importa legacy
            </Button>
            <Button variant="outline" onClick={handleDedup} disabled={busy} title="Cerca e rimuove entry duplicate (kind+label normalizzato o kind+URL host)">
              <Trash2 className="h-4 w-4 mr-2" />
              Dedup
            </Button>
            <Button onClick={openAdd} disabled={busy}>
              <Plus className="h-4 w-4 mr-2" />
              Aggiungi
            </Button>
          </div>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nessuna credenziale in vault.</p>
            {isAdmin && (
              <>
                <p className="text-sm mt-2">
                  <strong>Setup rapido</strong>: crea i 5 placeholder standard (Wazuh Manager + Indexer,
                  LibreNMS, Graylog, TrueNAS) e compila i secrets dopo via Modifica.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button onClick={handleSeedDefaults} disabled={busy}>
                    <KeyRound className="h-4 w-4 mr-2" />
                    Crea placeholder default
                  </Button>
                  <Button variant="outline" onClick={handleSync} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Importa legacy
                  </Button>
                  <Button variant="outline" onClick={openAdd} disabled={busy}>
                    <Plus className="h-4 w-4 mr-2" />
                    Aggiungi manuale
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => {
            const meta = KIND_META[item.kind] ?? KIND_META.other;
            const Icon = meta.icon;
            const rev = revealed[item.id];
            return (
              <Card key={item.id} className={item.enabled ? "" : "opacity-60"}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`h-5 w-5 shrink-0 ${meta.color}`} />
                      <CardTitle className="text-base truncate">{item.label}</CardTitle>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">{meta.label}</Badge>
                  </div>
                  {item.url && (
                    <CardDescription className="truncate text-xs font-mono">
                      {item.url}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {item.username && (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">User</span>
                      <div className="flex items-center gap-1 min-w-0">
                        <code className="text-xs truncate">{item.username}</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(item.username!, "Username")}
                          title="Copia username"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {item.has_password && (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">Password</span>
                      <div className="flex items-center gap-1 min-w-0">
                        <code className="text-xs truncate font-mono">
                          {rev?.password ?? "••••••••"}
                        </code>
                        {isAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleReveal(item)}
                              title={rev ? "Nascondi" : "Mostra (audit log)"}
                            >
                              {rev ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            {rev?.password && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => copyToClipboard(rev.password!, "Password")}
                                title="Copia password"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {item.has_api_token && rev?.api_token && (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">API token</span>
                      <div className="flex items-center gap-1 min-w-0">
                        <code className="text-xs truncate font-mono">{rev.api_token}</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(rev.api_token!, "Token")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Link → pagina di configurazione (deep-link). Variante
                      warning se entry incompleta. Per i kind senza pagina di
                      config dedicata mostriamo invece una nota testuale che
                      spiega dove la credenziale viene effettivamente usata. */}
                  {(() => {
                    const href = getIntegrationConfigHref(item);
                    if (href) {
                      const incomplete = isCredentialIncomplete(item);
                      // Label dinamico: "Impostazioni" per /settings,
                      // "wizard agenti" per /agents (Hub URL config sta lì).
                      const destinationLabel = href.startsWith("/agents")
                        ? "wizard agenti"
                        : "Impostazioni";
                      if (incomplete) {
                        return (
                          <a
                            href={href}
                            className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1 leading-tight">
                              Config incompleta — vai a {destinationLabel}
                            </span>
                            <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        );
                      }
                      const linkLabel = href.startsWith("/agents")
                        ? "Hub URL & enrollment →"
                        : "Configura integrazione →";
                      return (
                        <a
                          href={href}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <SettingsIcon className="h-3 w-3" />
                          {linkLabel}
                        </a>
                      );
                    }
                    // Nessuna pagina di config: mostra hint d'uso (se disponibile).
                    const hint = getCredentialUsageHint(item);
                    if (hint) {
                      return (
                        <p className="text-[11px] text-muted-foreground italic leading-snug">
                          {hint}
                        </p>
                      );
                    }
                    return null;
                  })()}

                  <div className="flex items-center gap-1 pt-2 border-t mt-2">
                    {item.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(item.url!, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Apri
                      </Button>
                    )}
                    {isAdmin && (item.url || item.api_url) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTest(item)}
                        disabled={testing === item.id}
                        title="Test connessione"
                      >
                        {testing === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : testResults[item.id] === "ok" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : testResults[item.id] === "fail" ? (
                          <XCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <Activity className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(item)}
                          title="Modifica"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(item)}
                          title="Elimina"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifica credenziale" : "Nuova credenziale"}</DialogTitle>
            <DialogDescription>
              I campi password/token vuoti vengono ignorati (non sovrascrivono il valore esistente).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm({ ...form, kind: v as CredentialKind })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_META) as CredentialKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{KIND_META[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Label</Label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Es. Wazuh PX-NAS"
                />
              </div>
            </div>
            <div>
              <Label>URL UI</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://10.0.0.3:8443"
              />
            </div>
            <div>
              <Label>URL API <span className="text-muted-foreground text-xs">(opzionale)</span></Label>
              <Input
                value={form.api_url}
                onChange={(e) => setForm({ ...form, api_url: e.target.value })}
                placeholder="https://10.0.0.3:55000"
              />
            </div>
            <div>
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <Label>
                Password <span className="text-muted-foreground text-xs">(vuoto = non cambiare)</span>
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.id ? "•••• (lascia vuoto per non cambiare)" : ""}
              />
            </div>
            <div>
              <Label>
                API Token <span className="text-muted-foreground text-xs">(vuoto = non cambiare)</span>
              </Label>
              <Input
                type="password"
                value={form.api_token}
                onChange={(e) => setForm({ ...form, api_token: e.target.value })}
                placeholder={form.id ? "•••• (lascia vuoto per non cambiare)" : ""}
              />
            </div>
            <div>
              <Label>Note</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>
              Annulla
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
