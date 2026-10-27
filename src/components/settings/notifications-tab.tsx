"use client";

import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function NotificationsTab() {
  const [cfg, setCfg] = useState<ConfigDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/notifications/config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          config: ConfigDto;
        };
        // I segreti tornano mascherati: azzero i campi così restano invariati
        // se l'utente non li riscrive.
        setCfg({ ...body.config, smtpPassword: "", webhookAuthHeader: "" });
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
        // Accendere e spegnere le notifiche e i canali si fa da Opzioni (22/10), e così livello, categorie e riepilogo
        // (23/10): il salvataggio qui non li tocca.
        body: JSON.stringify({
          smtpHost: cfg.smtpHost,
          smtpPort: Number(cfg.smtpPort),
          smtpSecure: cfg.smtpSecure,
          smtpUser: cfg.smtpUser,
          smtpPassword: cfg.smtpPassword,
          smtpFrom: cfg.smtpFrom,
          smtpTo: cfg.smtpTo,
          webhookUrl: cfg.webhookUrl,
          webhookAuthHeader: cfg.webhookAuthHeader,
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
        <CardContent>
          <RigheRimando ids={["notifiche.attive"]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Email (SMTP)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RigheRimando ids={["notifiche.email"]} mostraEsito={false} />
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
          <RigheRimando ids={["notifiche.webhook"]} mostraEsito={false} />
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
        <CardContent>
          <RigheRimando
            ids={["parametro.notify_immediate_min_level", "parametro.notify_immediate_categories", "parametro.notify_digest_interval_minutes"]}
            mostraEsito={false}
          />
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
