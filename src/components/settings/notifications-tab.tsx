"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Mail, Send, Webhook } from "lucide-react";

interface ConfigDto {
  enabled: boolean;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpTo: string;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookAuthHeader: string;
  policy: {
    immediateCategories: string[];
    immediateMinLevel: number;
    digestIntervalMinutes: number;
  };
  retentionDays: number;
}

interface CategoryDto {
  id: string;
  labelIt: string;
}

export function NotificationsTab() {
  const [cfg, setCfg] = useState<ConfigDto | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/notifications/config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          config: ConfigDto;
          categories: CategoryDto[];
        };
        // I segreti tornano mascherati: azzero i campi così restano invariati
        // se l'utente non li riscrive.
        setCfg({ ...body.config, smtpPassword: "", webhookAuthHeader: "" });
        setCategories(body.categories);
      } catch (e) {
        toast.error(`Errore nel caricamento: ${(e as Error).message}`);
      }
    })();
  }, []);

  function patch(p: Partial<ConfigDto>) {
    setCfg((c) => (c ? { ...c, ...p } : c));
  }

  async function handleSave() {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          smtpEnabled: cfg.smtpEnabled,
          smtpHost: cfg.smtpHost,
          smtpPort: Number(cfg.smtpPort),
          smtpSecure: cfg.smtpSecure,
          smtpUser: cfg.smtpUser,
          smtpPassword: cfg.smtpPassword,
          smtpFrom: cfg.smtpFrom,
          smtpTo: cfg.smtpTo,
          webhookEnabled: cfg.webhookEnabled,
          webhookUrl: cfg.webhookUrl,
          webhookAuthHeader: cfg.webhookAuthHeader,
          immediateCategories: cfg.policy.immediateCategories,
          immediateMinLevel: Number(cfg.policy.immediateMinLevel),
          digestIntervalMinutes: Number(cfg.policy.digestIntervalMinutes),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: unknown };
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      toast.success("Configurazione salvata");
      patch({ smtpPassword: "", webhookAuthHeader: "" });
    } catch (e) {
      toast.error(`Errore nel salvataggio: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        results?: { channel: string; ok: boolean; error?: string }[];
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      for (const r of body.results ?? []) {
        if (r.ok) toast.success(`${r.channel}: invio riuscito`);
        else toast.error(`${r.channel}: ${r.error ?? "invio fallito"}`);
      }
    } catch (e) {
      toast.error(`Errore: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  function toggleCategory(id: string, on: boolean) {
    if (!cfg) return;
    const set = new Set(cfg.policy.immediateCategories);
    if (on) set.add(id);
    else set.delete(id);
    patch({ policy: { ...cfg.policy, immediateCategories: [...set] } });
  }

  if (!cfg) return <div className="text-sm text-muted-foreground">Caricamento…</div>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Invio degli alert di sicurezza via email e webhook. Le categorie gravi
        partono subito; tutto il resto viene raggruppato in un riepilogo periodico.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stato</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch
            id="enabled"
            checked={cfg.enabled}
            onCheckedChange={(v: boolean) => patch({ enabled: v })}
          />
          <Label htmlFor="enabled">Notifiche attive</Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Email (SMTP)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="smtpEnabled"
              checked={cfg.smtpEnabled}
              onCheckedChange={(v: boolean) => patch({ smtpEnabled: v })}
            />
            <Label htmlFor="smtpEnabled">Canale email abilitato</Label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="smtpHost">Server SMTP</Label>
              <Input
                id="smtpHost"
                value={cfg.smtpHost}
                onChange={(e) => patch({ smtpHost: e.target.value })}
                placeholder="smtp.dominio.it"
              />
            </div>
            <div>
              <Label htmlFor="smtpPort">Porta</Label>
              <Input
                id="smtpPort"
                type="number"
                value={cfg.smtpPort}
                onChange={(e) => patch({ smtpPort: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Switch
                id="smtpSecure"
                checked={cfg.smtpSecure}
                onCheckedChange={(v: boolean) => patch({ smtpSecure: v })}
              />
              <Label htmlFor="smtpSecure">TLS implicito (porta 465)</Label>
            </div>
            <div>
              <Label htmlFor="smtpUser">Utente</Label>
              <Input
                id="smtpUser"
                value={cfg.smtpUser}
                onChange={(e) => patch({ smtpUser: e.target.value })}
                placeholder="lascia vuoto se il relay non richiede auth"
              />
            </div>
            <div>
              <Label htmlFor="smtpPassword">Password</Label>
              <Input
                id="smtpPassword"
                type="password"
                value={cfg.smtpPassword}
                onChange={(e) => patch({ smtpPassword: e.target.value })}
                placeholder="lascia vuoto per non modificarla"
              />
            </div>
            <div>
              <Label htmlFor="smtpFrom">Mittente</Label>
              <Input
                id="smtpFrom"
                value={cfg.smtpFrom}
                onChange={(e) => patch({ smtpFrom: e.target.value })}
                placeholder="da-ipam@dominio.it"
              />
            </div>
            <div>
              <Label htmlFor="smtpTo">Destinatari</Label>
              <Input
                id="smtpTo"
                value={cfg.smtpTo}
                onChange={(e) => patch({ smtpTo: e.target.value })}
                placeholder="uno o più indirizzi separati da virgola"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" /> Webhook
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="webhookEnabled"
              checked={cfg.webhookEnabled}
              onCheckedChange={(v: boolean) => patch({ webhookEnabled: v })}
            />
            <Label htmlFor="webhookEnabled">Canale webhook abilitato</Label>
          </div>
          <div>
            <Label htmlFor="webhookUrl">URL</Label>
            <Input
              id="webhookUrl"
              value={cfg.webhookUrl}
              onChange={(e) => patch({ webhookUrl: e.target.value })}
              placeholder="https://… (Teams, Slack, automazione)"
            />
          </div>
          <div>
            <Label htmlFor="webhookAuthHeader">Header Authorization (opzionale)</Label>
            <Input
              id="webhookAuthHeader"
              type="password"
              value={cfg.webhookAuthHeader}
              onChange={(e) => patch({ webhookAuthHeader: e.target.value })}
              placeholder="lascia vuoto per non modificarlo"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quando notificare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Categorie con invio immediato</Label>
            <div className="mt-2 space-y-2">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`cat-${c.id}`}
                    checked={cfg.policy.immediateCategories.includes(c.id)}
                    onCheckedChange={(v: boolean) => toggleCategory(c.id, v === true)}
                  />
                  <Label htmlFor={`cat-${c.id}`} className="font-normal">
                    {c.labelIt}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="minLevel">Livello per invio immediato</Label>
              <Input
                id="minLevel"
                type="number"
                value={cfg.policy.immediateMinLevel}
                onChange={(e) =>
                  patch({
                    policy: { ...cfg.policy, immediateMinLevel: Number(e.target.value) },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="digest">Riepilogo ogni (minuti)</Label>
              <Input
                id="digest"
                type="number"
                value={cfg.policy.digestIntervalMinutes}
                onChange={(e) =>
                  patch({
                    policy: {
                      ...cfg.policy,
                      digestIntervalMinutes: Number(e.target.value),
                    },
                  })
                }
              />
            </div>

          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Salvataggio…" : "Salva"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          <Send className="mr-2 h-4 w-4" />
          {testing ? "Invio…" : "Invia notifica di prova"}
        </Button>
      </div>
    </div>
  );
}
