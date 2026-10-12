"use client";

/**
 * Card «Controller UniFi» nel tab Moduli (tappa 2, Task 7 del piano UniFi).
 *
 * Configura la lettura del controller UniFi del cliente (in sola lettura:
 * apparati, porte, vicini LLDP). Nasce spenta. Password e chiave API sono in
 * sola scrittura: il server dice solo se ci sono. L'impronta del certificato
 * si fissa al primo collegamento riuscito; cambiarla è un'azione esplicita,
 * con conferma. Prova e sincronizzazione usano la configurazione SALVATA, per
 * questo restano ferme finché il modulo ha modifiche non salvate.
 *
 * `UnifiCardView` è la parte che disegna, senza stato né rete: le prove la
 * rendono sul server (`__tests__/unifi-card.test.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { UnifiKind } from "@/lib/integrations/types";
import type { UnifiProbeResult } from "@/lib/integrations/unifi-api";
import {
  buildUnifiPayload,
  describeUnifiProbe,
  describeUnifiSync,
  isUnifiFormDirty,
  parseUnifiSavedConfig,
  parseUnifiSyncResponse,
  unifiFormFromConfig,
  unifiUrlChangesController,
  type UnifiForm,
  type UnifiSavedConfig,
  type UnifiSyncResponse,
} from "./unifi-card-model";

export type UnifiPinAction =
  | { kind: "forget" }
  | { kind: "accept"; pin: string; replaces: string };

export type UnifiBusy = null | "save" | "test" | "sync" | "pin";

export interface UnifiCardViewProps {
  isAdmin: boolean;
  saved: UnifiSavedConfig;
  form: UnifiForm;
  busy: UnifiBusy;
  probe: UnifiProbeResult | null;
  sync: UnifiSyncResponse | null;
  pinAction: UnifiPinAction | null;
  onFormChange: (patch: Partial<UnifiForm>) => void;
  onSave: () => void;
  onTest: () => void;
  onSync: () => void;
  onPinAction: (action: UnifiPinAction | null) => void;
  onConfirmPinAction: () => void;
}

const TONE_BOX = {
  ok: "border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200",
  warning: "border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  error: "border-destructive/50 bg-destructive/10 text-destructive",
} as const;

function Pin({ value }: { value: string }) {
  return <code className="block font-mono text-xs break-all">{value}</code>;
}

export function UnifiCardView(props: UnifiCardViewProps) {
  const { isAdmin, saved, form, busy, probe, sync, pinAction } = props;
  const set = props.onFormChange;
  const dirty = isUnifiFormDirty(form, saved);
  const locked = !isAdmin || busy !== null;
  const isCloud = form.kind === "cloud";
  const urlChanged = unifiUrlChangesController(form, saved);
  const probeView = probe ? describeUnifiProbe(probe) : null;
  const syncView = sync ? describeUnifiSync(sync) : null;
  const canUseSaved = isAdmin && busy === null && !dirty;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              Controller UniFi
            </CardTitle>
            <CardDescription className="mt-1">
              Legge switch e access point dal controller UniFi, in sola lettura: apparati, porte e
              vicini LLDP arrivano in DA-IPAM e popolano la mappa di rete. Sul controller non si
              scrive niente.
            </CardDescription>
          </div>
          {saved.mode === "external" ? (
            <Badge>Attivo</Badge>
          ) : (
            <Badge variant="secondary">Disattivato</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Modalità</Label>
            <Select
              value={form.mode}
              disabled={locked}
              onValueChange={(v) => set({ mode: v === "external" ? "external" : "disabled" })}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">Disattivata</SelectItem>
                <SelectItem value="external">Attiva</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tipo di controller</Label>
            <Select
              value={form.kind}
              disabled={locked}
              onValueChange={(v) => set({ kind: (v as UnifiKind) ?? "self_hosted" })}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self_hosted">Self-hosted (UniFi Network Application)</SelectItem>
                <SelectItem value="udm">UniFi OS (UDM, Cloud Key)</SelectItem>
                <SelectItem value="cloud">Cloud (Site Manager)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {form.kind !== "self_hosted" && (
          <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${TONE_BOX.warning}`}>
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Questo tipo di controller non è ancora supportato: la configurazione si salva, ma prova e
              sincronizzazione risponderanno «non ancora supportato». Per ora si legge solo il
              controller self-hosted.
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {!isCloud && (
            <div>
              <Label htmlFor="unifi-url" className="text-xs text-muted-foreground">
                Indirizzo del controller
              </Label>
              <Input
                id="unifi-url"
                className="mt-1 font-mono text-xs"
                placeholder="https://192.168.1.10:8443"
                value={form.url}
                disabled={locked}
                onChange={(e) => set({ url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">Solo https; di solito la porta è 8443.</p>
              {urlChanged && saved.passwordSet && (
                <p className="text-xs text-foreground mt-1">
                  Indirizzo di un altro controller: al salvataggio la password salvata si cancella e il
                  certificato si fissa di nuovo. Riscrivi la password del nuovo controller.
                </p>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="unifi-site" className="text-xs text-muted-foreground">
              Site
            </Label>
            <Input
              id="unifi-site"
              className="mt-1 font-mono text-xs"
              placeholder="default"
              value={form.site}
              disabled={locked}
              onChange={(e) => set({ site: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Il nome interno, quello nell&apos;indirizzo della console (…/manage/site/<em>nome</em>/).
            </p>
          </div>
          {!isCloud && (
            <>
              <div>
                <Label htmlFor="unifi-username" className="text-xs text-muted-foreground">
                  Utente
                </Label>
                <Input
                  id="unifi-username"
                  className="mt-1"
                  autoComplete="off"
                  value={form.username}
                  disabled={locked}
                  onChange={(e) => set({ username: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Meglio un utente locale in sola lettura, senza verifica in due passaggi.
                </p>
              </div>
              <div>
                <Label htmlFor="unifi-password" className="text-xs text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="unifi-password"
                  className="mt-1"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    saved.passwordSet
                      ? urlChanged
                        ? "Da riscrivere per il nuovo indirizzo"
                        : "Impostata: lascia vuoto per non cambiarla"
                      : ""
                  }
                  value={form.password}
                  disabled={locked}
                  onChange={(e) => set({ password: e.target.value })}
                />
              </div>
            </>
          )}
          {isCloud && (
            <div>
              <Label htmlFor="unifi-api-token" className="text-xs text-muted-foreground">
                Chiave API
              </Label>
              <Input
                id="unifi-api-token"
                className="mt-1"
                type="password"
                autoComplete="off"
                placeholder={saved.apiTokenSet ? "Impostata: lascia vuoto per non cambiarla" : ""}
                value={form.apiToken}
                disabled={locked}
                onChange={(e) => set({ apiToken: e.target.value })}
              />
            </div>
          )}
        </div>

        {/* Certificato del controller */}
        <div className="rounded-md border px-3 py-2 text-sm">
          {saved.certPin ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  Certificato del controller fissato
                </p>
                <Pin value={saved.certPin} />
              </div>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => props.onPinAction({ kind: "forget" })}
                >
                  Dimentica il certificato
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Nessun certificato fissato: la prima prova di connessione riuscita fissa quello del
              controller, e da lì un certificato diverso viene rifiutato.
            </p>
          )}
        </div>

        {probeView && (
          <div className={`rounded-md border px-3 py-2 text-sm space-y-1.5 ${TONE_BOX[probeView.tone]}`}>
            <p className="flex items-center gap-1.5 font-medium">
              {probeView.tone === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {probeView.title}
            </p>
            {probeView.detail && <p className="text-xs">{probeView.detail}</p>}
            {probeView.pins && (
              <div className="space-y-1.5 pt-1 text-foreground">
                <div>
                  <p className="text-xs text-muted-foreground">Impronta fissata al primo collegamento</p>
                  <Pin value={probeView.pins.expected} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Impronta presentata adesso</p>
                  <Pin value={probeView.pins.presented} />
                </div>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      probeView.pins &&
                      props.onPinAction({
                        kind: "accept",
                        pin: probeView.pins.presented,
                        replaces: probeView.pins.expected,
                      })
                    }
                  >
                    Accetta la nuova impronta
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {syncView && (
          <div className={`rounded-md border px-3 py-2 text-sm space-y-2 ${TONE_BOX[syncView.tone]}`}>
            <p className="font-medium">{syncView.title}</p>
            <dl className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-foreground">
              {syncView.counts.map((c) => (
                <div key={c.label}>
                  <dt className="text-xs text-muted-foreground">{c.label}</dt>
                  <dd className="font-semibold tabular-nums">{c.value}</dd>
                </div>
              ))}
            </dl>
            {syncView.skippedReasons.length > 0 && (
              <div className="text-foreground">
                <p className="text-xs font-medium">Saltati, con il motivo</p>
                <ul className="list-disc pl-5 text-xs">
                  {syncView.skippedReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {syncView.offline.length > 0 && (
              <div className="text-foreground">
                <p className="text-xs font-medium">
                  Non connessi al controller: porte e vicini restano quelli dell&apos;ultima sincronizzazione
                </p>
                <ul className="list-disc pl-5 text-xs">
                  {syncView.offline.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {syncView.errors.length > 0 && (
              <div>
                <p className="text-xs font-medium">Errori</p>
                <ul className="list-disc pl-5 text-xs">
                  {syncView.errors.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Solo un amministratore può cambiare la configurazione e avviare prove e sincronizzazioni.
          </p>
        )}
        {isAdmin && dirty && (
          <p className="text-xs text-muted-foreground">
            Modifiche non salvate: prova e sincronizzazione usano la configurazione salvata.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={props.onSave} disabled={locked || !dirty}>
            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Salva
          </Button>
          <Button size="sm" variant="outline" onClick={props.onTest} disabled={!canUseSaved}>
            {busy === "test" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Prova connessione
          </Button>
          {saved.mode === "external" && (
            <Button size="sm" variant="outline" onClick={props.onSync} disabled={!canUseSaved}>
              {busy === "sync" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              Sincronizza ora
            </Button>
          )}
          {saved.browserUrl && saved.kind !== "cloud" && (
            <a
              href={saved.browserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Apri la console del controller
            </a>
          )}
        </div>
        {saved.mode === "external" && (
          <p className="text-xs text-muted-foreground">
            Per ora la sincronizzazione parte solo a mano, da qui.
          </p>
        )}
      </CardContent>

      <Dialog
        open={pinAction !== null}
        onOpenChange={(open) => {
          if (!open && busy !== "pin") props.onPinAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pinAction?.kind === "accept"
                ? "Accettare il nuovo certificato del controller?"
                : "Dimenticare il certificato del controller?"}
            </DialogTitle>
            <DialogDescription>
              {pinAction?.kind === "accept"
                ? "Da adesso DA-IPAM si fiderà solo del certificato con l'impronta qui sotto. Accettala solo se sai che il certificato del controller è stato rinnovato: un certificato diverso può anche voler dire che qualcuno si è messo in mezzo."
                : "La prossima prova di connessione, o la prossima sincronizzazione, accetterà il certificato che il controller presenta in quel momento e lo fisserà di nuovo. Serve quando il certificato del controller è stato rinnovato."}
            </DialogDescription>
          </DialogHeader>
          {pinAction?.kind === "accept" && <Pin value={pinAction.pin} />}
          <DialogFooter>
            <Button variant="outline" disabled={busy === "pin"} onClick={() => props.onPinAction(null)}>
              Annulla
            </Button>
            <Button disabled={busy === "pin"} onClick={props.onConfirmPinAction}>
              {busy === "pin" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {pinAction?.kind === "accept" ? "Accetta la nuova impronta" : "Dimentica il certificato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function UnifiCard({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState<UnifiSavedConfig | null>(null);
  const [form, setForm] = useState<UnifiForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<UnifiBusy>(null);
  const [probe, setProbe] = useState<UnifiProbeResult | null>(null);
  const [sync, setSync] = useState<UnifiSyncResponse | null>(null);
  const [pinAction, setPinAction] = useState<UnifiPinAction | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<unknown>("/api/integrations/unifi", { cache: "no-store" });
    if (!r.ok) {
      setLoadError(r.message);
      return;
    }
    const cfg = parseUnifiSavedConfig(r.data);
    setLoadError(null);
    setSaved(cfg);
    setForm(unifiFormFromConfig(cfg));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return <LoadError what="la configurazione UniFi" message={loadError} onRetry={() => void load()} />;
  }
  if (!saved || !form) {
    return <div className="rounded-md border p-4 text-sm text-muted-foreground">Caricamento…</div>;
  }

  const save = async () => {
    setBusy("save");
    try {
      const r = await fetchJson<unknown>("/api/integrations/unifi", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify(buildUnifiPayload(form)),
      });
      if (!r.ok) {
        toast.error(`Configurazione non salvata: ${r.message}`);
        return;
      }
      toast.success("Configurazione UniFi salvata");
      setProbe(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setProbe(null);
    try {
      const r = await fetchJson<UnifiProbeResult>("/api/integrations/unifi/test-connection", { cache: "no-store" });
      if (!r.ok) {
        toast.error(`Prova non eseguita: ${r.message}`);
        return;
      }
      setProbe(r.data);
      const v = describeUnifiProbe(r.data);
      if (v.tone === "ok") toast.success(v.title);
      else toast.error(v.title);
      // Al primo collegamento riuscito il server ha fissato l'impronta: rileggerla.
      await load();
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy("sync");
    setSync(null);
    try {
      const r = await fetchJson<unknown>("/api/integrations/unifi/sync", { method: "POST" });
      if (!r.ok) {
        toast.error(`Sincronizzazione non eseguita: ${r.message}`);
        return;
      }
      const s = parseUnifiSyncResponse(r.data);
      if (!s) {
        toast.error("Risposta della sincronizzazione non leggibile");
        return;
      }
      setSync(s);
      const v = describeUnifiSync(s);
      if (v.tone === "ok") toast.success(v.title);
      else if (v.tone === "warning") toast.warning(v.title);
      else toast.error(v.title);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const confirmPinAction = async () => {
    if (!pinAction) return;
    setBusy("pin");
    try {
      const r =
        pinAction.kind === "forget"
          ? await fetchJson<unknown>("/api/integrations/unifi/cert-pin", { method: "DELETE" })
          : await fetchJson<unknown>("/api/integrations/unifi/cert-pin", {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify({ pin: pinAction.pin, replaces: pinAction.replaces }),
            });
      if (!r.ok) {
        toast.error(`Impronta non cambiata: ${r.message}`);
        return;
      }
      toast.success(
        pinAction.kind === "forget"
          ? "Certificato dimenticato: la prossima prova riuscita fisserà quello del controller"
          : "Nuova impronta accettata: riprova la connessione",
      );
      setPinAction(null);
      setProbe(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <UnifiCardView
      isAdmin={isAdmin}
      saved={saved}
      form={form}
      busy={busy}
      probe={probe}
      sync={sync}
      pinAction={pinAction}
      onFormChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
      onSave={() => void save()}
      onTest={() => void test()}
      onSync={() => void runSync()}
      onPinAction={setPinAction}
      onConfirmPinAction={() => void confirmPinAction()}
    />
  );
}
