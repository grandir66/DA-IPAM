"use client";

/**
 * Dialog «Aggiungi / Modifica controller». «Prova» legge il controller coi
 * campi del modulo prima di salvare (POST /api/controllers/probe) e conserva
 * l'impronta del certificato vista: va nel corpo del salvataggio. «Salva» non
 * lancia nessuna sincronizzazione.
 */
import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/fetch-json";
import type { ControllerKind, NetworkControllerView } from "@/lib/controllers/types";
import {
  KIND_OPTIONS,
  SCHEDULE_OPTIONS,
  buildControllerPayload,
  describeProbe,
  emptyControllerForm,
  formFromController,
  formMissing,
  parseProbeResult,
  secretPlaceholder,
  urlPlaceholder,
  type ControllerForm,
  type ProbeResult,
} from "./controllers-model";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function ControllerDialog({
  controller,
  onClose,
  onSaved,
}: {
  /** null = nuovo controller. */
  controller: NetworkControllerView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = controller !== null;
  const [form, setForm] = useState<ControllerForm>(() =>
    controller ? formFromController(controller) : emptyControllerForm(),
  );
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState<null | "probe" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<ControllerForm>) => setForm((f) => ({ ...f, ...patch }));
  /** Un indirizzo o un tipo diversi sono un altro controller: la prova vecchia non vale più. */
  const setTarget = (patch: Partial<ControllerForm>) => {
    setProbe(null);
    set(patch);
  };

  const isUdm = form.kind === "udm";
  const probeView = probe ? describeProbe(probe) : null;
  const sites = probe?.ok ? probe.sites : [];
  const missing = formMissing(form);
  const keySet = editing && controller.apiKeySet;
  const passSet = editing && controller.passwordSet;

  const runProbe = async () => {
    setBusy("probe");
    setError(null);
    try {
      const body = { ...buildControllerPayload(form), ...(editing ? { id: controller.id } : {}) };
      const r = await fetchJson<unknown>("/api/controllers/probe", {
        method: "POST",
        headers: JSON_HEADERS,
        cache: "no-store",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setProbe(null);
        setError(`Prova non eseguita: ${r.message}`);
        return;
      }
      const p = parseProbeResult(r.data);
      if (!p) {
        setError("Risposta della prova non leggibile");
        return;
      }
      setProbe(p);
      if (p.ok && p.sites.length > 0 && !p.sites.some((s) => s.name === form.site)) {
        set({ site: p.sites[0].name });
      }
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const body = buildControllerPayload(form, probe?.ok ? probe.certPin : null);
      const r = await fetchJson<{ warning?: unknown }>(
        editing ? `/api/controllers/${controller.id}` : "/api/controllers",
        { method: editing ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
      );
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const warning = r.data && typeof r.data.warning === "string" ? r.data.warning : null;
      if (warning) toast.warning(warning);
      toast.success(editing ? "Controller aggiornato" : "Controller aggiunto");
      onSaved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && busy === null && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Modifica «${controller.name}»` : "Aggiungi controller"}</DialogTitle>
          <DialogDescription>
            Si legge in sola lettura: apparati, porte e vicini. Sul controller non si scrive niente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-[13px] text-muted-foreground">Tipo</Label>
            <Select
              value={form.kind}
              disabled={busy !== null}
              onValueChange={(v) => v && setTarget({ kind: v as ControllerKind })}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ctl-name" className="text-[13px] text-muted-foreground">
                Nome
              </Label>
              <Input
                id="ctl-name"
                className="mt-1"
                value={form.name}
                disabled={busy !== null}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ctl-url" className="text-[13px] text-muted-foreground">
                Indirizzo
              </Label>
              <Input
                id="ctl-url"
                className="mt-1 font-mono text-[13px]"
                placeholder={urlPlaceholder(form.kind)}
                value={form.url}
                disabled={busy !== null}
                onChange={(e) => setTarget({ url: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ctl-site" className="text-[13px] text-muted-foreground">
              Site
            </Label>
            {sites.length > 0 ? (
              <Select value={form.site} disabled={busy !== null} onValueChange={(v) => v && set({ site: v })}>
                <SelectTrigger id="ctl-site" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.desc ? `${s.desc} (${s.name})` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="ctl-site"
                className="mt-1 font-mono text-[13px]"
                placeholder="default"
                value={form.site}
                disabled={busy !== null}
                onChange={(e) => set({ site: e.target.value })}
              />
            )}
          </div>

          {isUdm ? (
            <div>
              <Label htmlFor="ctl-key" className="text-[13px] text-muted-foreground">
                Chiave API
              </Label>
              <Input
                id="ctl-key"
                className="mt-1"
                type="password"
                autoComplete="off"
                placeholder={secretPlaceholder(keySet)}
                value={form.apiKey}
                disabled={busy !== null}
                onChange={(e) => set({ apiKey: e.target.value })}
              />
              <p className="mt-1 text-[13px] text-muted-foreground">
                Si crea sulla console UniFi, nell'app Network: Control Plane, poi Integrazioni.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ctl-user" className="text-[13px] text-muted-foreground">
                  Utente
                </Label>
                <Input
                  id="ctl-user"
                  className="mt-1"
                  autoComplete="off"
                  value={form.username}
                  disabled={busy !== null}
                  onChange={(e) => set({ username: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ctl-pass" className="text-[13px] text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="ctl-pass"
                  className="mt-1"
                  type="password"
                  autoComplete="new-password"
                  placeholder={secretPlaceholder(passSet)}
                  value={form.password}
                  disabled={busy !== null}
                  onChange={(e) => set({ password: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[13px] text-muted-foreground">Pianificazione</Label>
              <Select
                value={form.schedule}
                disabled={busy !== null}
                onValueChange={(v) => set({ schedule: v ?? "" })}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_OPTIONS.map((o) => (
                    <SelectItem key={o.value || "off"} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enabled}
                  disabled={busy !== null}
                  onCheckedChange={(v) => set({ enabled: v })}
                />
                Attivo
              </label>
            </div>
          </div>

          {probeView && (
            <div
              className={`rounded-md border px-3 py-2 text-sm space-y-1.5 ${
                probeView.tone === "ok"
                  ? "border-green-700/40 bg-green-50 text-green-900"
                  : "border-destructive/50 bg-destructive/10 text-destructive"
              }`}
            >
              <p className="flex items-center gap-1.5 font-medium">
                {probeView.tone === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                {probeView.title}
              </p>
              {probeView.detail && <p className="text-[13px]">{probeView.detail}</p>}
              {probeView.pins && (
                <div className="space-y-1 pt-1 text-foreground">
                  {probeView.pins.expected && (
                    <div>
                      <p className="text-[13px] text-muted-foreground">Impronta fissata al primo collegamento</p>
                      <code className="block font-mono text-[13px] break-all">{probeView.pins.expected}</code>
                    </div>
                  )}
                  <div>
                    <p className="text-[13px] text-muted-foreground">Impronta presentata adesso</p>
                    <code className="block font-mono text-[13px] break-all">{probeView.pins.presented}</code>
                  </div>
                  {editing && (
                    <p className="text-[13px] text-muted-foreground">
                      Per accettarla, chiudi il modulo e usa «Accetta il nuovo certificato» nel dettaglio del controller.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={onClose}>
            Annulla
          </Button>
          <Button variant="outline" disabled={busy !== null || missing !== null} title={missing ?? undefined} onClick={() => void runProbe()}>
            {busy === "probe" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Prova
          </Button>
          <Button disabled={busy !== null || missing !== null} title={missing ?? undefined} onClick={() => void save()}>
            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
