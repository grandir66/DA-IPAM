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

const KIND_META: Record<CredentialKind, { icon: typeof Shield; label: string; color: string }> = {
  wazuh: { icon: Shield, label: "Wazuh", color: "text-blue-600" },
  graylog: { icon: Activity, label: "Graylog", color: "text-amber-600" },
  librenms: { icon: Server, label: "LibreNMS", color: "text-emerald-600" },
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

export function LaunchpadClient({ initialItems }: { initialItems: SystemCredential[] }) {
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

  // Le entry con label che termina in "(API interna)" sono per consumo
  // container-to-container (URL interni tipo 10.255.255.x, librenms:8000,
  // host.docker.internal:8080) e non si possono aprire dal browser. Nascoste
  // di default; toggle per esporle quando servono per debugging/curl.
  const internalCount = items.filter((i) => /\(API interna\)/.test(i.label)).length;
  const visibleItems = showInternal
    ? items
    : items.filter((i) => !/\(API interna\)/.test(i.label));

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
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
              <p className="text-sm mt-2">
                Usa <strong>Importa legacy</strong> per migrare le integrazioni esistenti,
                oppure <strong>Aggiungi</strong> manualmente.
              </p>
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
