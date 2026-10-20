"use client";
import { parseDbDate } from "@/lib/db-date";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Smartphone, Save, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useUrlPerBrowser } from "@/components/shared/url-per-browser";

interface MdmConfig {
  base_url: string | null;
  username: string | null;
  user_field: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  /** Spenta da sola dopo troppi errori di fila, non dall'admin. */
  auto_disabled: boolean;
}

interface SyncResult {
  devices: number;
  changed: number;
  error?: string;
}

const USER_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "description", label: "Descrizione (description)" },
  { value: "custom1", label: "Campo personalizzato 1 (custom1)" },
  { value: "custom2", label: "Campo personalizzato 2 (custom2)" },
  { value: "custom3", label: "Campo personalizzato 3 (custom3)" },
];

function quando(v: string | null): string {
  return v ? parseDbDate(v).toLocaleString("it-IT") : "Mai";
}

export function MdmSettingsClient({
  config,
  maxErrori,
  intervalloMinuti,
}: {
  config: MdmConfig;
  /** Errori di fila dopo cui la sincronizzazione si spegne da sola. */
  maxErrori: number;
  /** Ogni quanto gira la sincronizzazione automatica (minuti). */
  intervalloMinuti: number;
}) {
  const router = useRouter();
  const perBrowser = useUrlPerBrowser();

  const [baseUrl, setBaseUrl] = useState(config.base_url ?? "");
  const [username, setUsername] = useState(config.username ?? "");
  const [password, setPassword] = useState("");
  const [userField, setUserField] = useState(config.user_field || "description");
  const [enabled, setEnabled] = useState(config.enabled);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        base_url: baseUrl,
        username,
        user_field: userField,
        enabled,
      };
      if (password) body.password = password;
      const res = await fetch("/api/mdm/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(typeof data.error === "string" ? data.error : "Errore nel salvataggio");
        return;
      }
      const esito = (await res.json().catch(() => null)) as { riattivato?: boolean } | null;
      toast.success(
        esito?.riattivato
          ? "Configurazione MDM salvata: sincronizzazione riattivata, errori azzerati"
          : "Configurazione MDM salvata",
      );
      setPassword("");
      router.refresh();
    } catch (e) {
      toast.error("Errore di rete: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/mdm/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<SyncResult> & { error?: string };
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : `Errore ${res.status}`;
        setSyncResult({ devices: 0, changed: 0, error: msg });
        toast.error("Sincronizzazione fallita: " + msg);
        return;
      }
      const result: SyncResult = {
        devices: typeof data.devices === "number" ? data.devices : 0,
        changed: typeof data.changed === "number" ? data.changed : 0,
        error: data.error,
      };
      setSyncResult(result);
      if (result.error) {
        toast.error("Sincronizzazione: " + result.error);
      } else {
        toast.success(`Sincronizzazione completata: ${result.devices} dispositivi, ${result.changed} modifiche`);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncResult({ devices: 0, changed: 0, error: msg });
      toast.error("Errore di rete: " + msg);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* === Connessione === */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Connessione Headwind MDM</CardTitle>
          </div>
          <CardDescription>
            Indirizzo e credenziali del pannello Headwind MDM. La password viene
            cifrata at-rest e non è mai mostrata: lascia il campo vuoto per
            mantenere quella esistente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mdm-base-url">URL base</Label>
            <Input
              id="mdm-base-url"
              type="text"
              placeholder="http://192.168.99.50:8088"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="max-w-md"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mdm-username">Username</Label>
            <Input
              id="mdm-username"
              type="text"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="max-w-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mdm-password">Password</Label>
            <Input
              id="mdm-password"
              type="password"
              placeholder={config.username ? "•••••• (lascia vuoto per non modificare)" : "Password del pannello MDM"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="max-w-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Campo utente (mappa il profilo utente del dispositivo)</Label>
            <Select value={userField} onValueChange={(v) => setUserField(v ?? userField)}>
              <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {USER_FIELD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Stato</Label>
            <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-foreground text-muted-foreground pl-1">
              <Checkbox
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked === true)}
              />
              <span className={enabled ? "text-foreground font-medium" : ""}>
                Integrazione MDM attiva (sincronizzazione automatica ogni {intervalloMinuti} minuti)
              </span>
            </label>
            <p className="text-xs text-muted-foreground pl-1">
              Accesa, crea il job pianificato «mdm_sync»; spenta, lo toglie. Dopo {maxErrori} errori
              consecutivi la sincronizzazione si spegne da sola: riattivarla azzera il contatore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleSave()} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Salvataggio…" : "Salva"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizzazione…" : "Sincronizza ora"}
            </Button>
            {baseUrl.trim() && (
              <a
                href={perBrowser(baseUrl.trim())}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[#00A7E7] hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Apri pannello Headwind
              </a>
            )}
          </div>

          {syncResult && (
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                syncResult.error
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-green-500/30 bg-green-50/30 dark:bg-green-950/20 text-green-800 dark:text-green-400"
              }`}
            >
              {syncResult.error
                ? `Errore: ${syncResult.error}`
                : `Sincronizzazione completata: ${syncResult.devices} dispositivi, ${syncResult.changed} modifiche.`}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Stato sincronizzazione === */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {config.consecutive_errors > 0 ? (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            )}
            <CardTitle className="text-base">Stato sincronizzazione</CardTitle>
          </div>
          <CardDescription>
            Esito dell&apos;ultima sincronizzazione con il server MDM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.auto_disabled && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                La sincronizzazione si è spenta da sola dopo {config.consecutive_errors} errori
                consecutivi (il limite è {maxErrori}), per non interrogare a vuoto il server MDM.
                Controlla l&apos;ultimo errore qui sotto, correggi indirizzo o credenziali, poi
                spunta «Integrazione MDM attiva» e salva: il contatore riparte da zero.
              </span>
            </div>
          )}
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Ultimo tentativo</dt>
              <dd className="font-medium">{quando(config.last_attempt_at ?? config.last_sync_at)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Ultima riuscita</dt>
              <dd className="font-medium">{quando(config.last_success_at)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Errori consecutivi</dt>
              <dd className={`font-medium ${config.consecutive_errors > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                {config.consecutive_errors}
                {config.auto_disabled && " (spenta da sola)"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Ultimo errore</dt>
              <dd className={`font-medium ${config.last_error ? "text-destructive" : ""}`}>
                {config.last_error ?? "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
