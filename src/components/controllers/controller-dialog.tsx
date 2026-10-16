"use client";

/**
 * Dialog «Aggiungi / Modifica controller». «Prova» legge il controller coi
 * campi del modulo prima di salvare (POST /api/controllers/probe) e conserva
 * l'impronta del certificato vista: va nel corpo del salvataggio. «Salva» non
 * lancia nessuna sincronizzazione.
 *
 * Credenziale (tappa 2f credenziali, T23, interfaccia punto 2): una tendina
 * di voci «Controller UniFi» filtrate per tipo (console UniFi OS: chiave o
 * utente locale, secondo l'accesso scelto; self-hosted: utente), e accanto
 * «Nuova nell'archivio», che apre i campi e crea la voce al salvataggio. Se
 * l'indirizzo cambia la scelta si svuota: la credenziale salvata non parte
 * verso un indirizzo nuovo senza che la si scelga di nuovo.
 */
import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { ControllerKind, NetworkControllerView } from "@/lib/controllers/types";
import {
  KIND_OPTIONS,
  SCHEDULE_OPTIONS,
  UDM_AUTH_OPTIONS,
  buildControllerPayload,
  credenzialeFormaVecchia,
  describeProbe,
  emptyControllerForm,
  formFromController,
  formMissing,
  nomeVoceNuova,
  parseProbeResult,
  parseVociArchivio,
  stessoIndirizzo,
  urlPlaceholder,
  vociPerController,
  type ControllerForm,
  type ProbeResult,
  type VoceArchivio,
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
  const [voci, setVoci] = useState<VoceArchivio[] | null>(null);
  const [vociError, setVociError] = useState<string | null>(null);

  const loadVoci = useCallback(async () => {
    const r = await fetchJson<unknown>("/api/credentials", { cache: "no-store" });
    if (!r.ok) {
      setVociError(r.message);
      return;
    }
    const lista = parseVociArchivio(r.data);
    if (!lista) {
      setVociError("Risposta dell'archivio non leggibile");
      return;
    }
    setVociError(null);
    setVoci(lista);
  }, []);

  useEffect(() => {
    void loadVoci();
  }, [loadVoci]);

  const set = (patch: Partial<ControllerForm>) => setForm((f) => ({ ...f, ...patch }));
  /** Un indirizzo o un tipo diversi sono un altro controller: la prova vecchia non vale più. */
  const setTarget = (patch: Partial<ControllerForm>) => {
    setProbe(null);
    set(patch);
  };

  const isUdm = form.kind === "udm";
  const useKey = isUdm && form.udmAuth === "api_key";
  const probeView = probe ? describeProbe(probe) : null;
  const sites = probe?.ok ? probe.sites : [];
  const moved = editing && !stessoIndirizzo(form.url, controller.url);
  const ammesse = voci ? vociPerController(voci, form.kind, form.udmAuth) : [];
  // Una voce che non vale per il tipo o l'accesso scelti non si manda: se ne sceglie un'altra.
  const scelta =
    form.credentialId !== null && (voci === null || ammesse.some((v) => v.id === form.credentialId)) ? form.credentialId : null;
  // Riga di prima della 2f mai convertita: senza voce, con i segreti nelle colonne (stato del server).
  const formaVecchia = editing && credenzialeFormaVecchia(controller);
  const sent: ControllerForm = { ...form, credentialId: scelta };
  const missing = formMissing(sent, { salvata: formaVecchia && !moved });
  const sceltaDaRifare = moved && !form.nuova && scelta === null && (controller.credentialId !== null || formaVecchia);

  /** Un indirizzo diverso da quello salvato svuota la scelta; tornando a quello salvato torna la sua voce. */
  const setUrl = (url: string) => {
    if (!editing) return setTarget({ url });
    const altrove = !stessoIndirizzo(url, controller.url);
    if (altrove && !moved) setTarget({ url, credentialId: null });
    else if (!altrove && moved && form.credentialId === null) setTarget({ url, credentialId: controller.credentialId });
    else setTarget({ url });
  };

  const vociPlaceholder =
    voci === null
      ? vociError
        ? "Voci dell'archivio non caricate"
        : "Caricamento delle voci…"
      : formaVecchia && !moved
        ? "Credenziale nella forma vecchia: resta finché non ne scegli una"
        : ammesse.length === 0
          ? "Nessuna voce adatta nell'archivio"
          : "Scegli una voce dell'archivio";

  const runProbe = async () => {
    setBusy("probe");
    setError(null);
    try {
      const body = { ...buildControllerPayload(sent), ...(editing ? { id: controller.id } : {}) };
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
      const body = buildControllerPayload(sent, probe?.ok ? probe.certPin : null);
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
                onChange={(e) => setUrl(e.target.value)}
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

          {isUdm && (
            <div>
              <Label className="text-[13px] text-muted-foreground">Accesso alla console</Label>
              <div
                className="mt-1 grid grid-cols-2 overflow-hidden rounded-md border border-foreground text-sm"
                role="group"
                aria-label="Accesso alla console"
              >
                {UDM_AUTH_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={form.udmAuth === o.value}
                    disabled={busy !== null}
                    onClick={() => setTarget({ udmAuth: o.value })}
                    className={cn(
                      "px-3 py-1.5",
                      form.udmAuth === o.value
                        ? "bg-foreground font-semibold text-background"
                        : "bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    {form.udmAuth === o.value && "● "}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="ctl-cred" className="text-[13px] text-muted-foreground">
              Credenziale
            </Label>
            {form.nuova ? (
              <div className="mt-1 space-y-2 rounded-md border border-input p-3">
                {useKey ? (
                  <div>
                    <Label htmlFor="ctl-key" className="text-[13px] text-muted-foreground">
                      Chiave API
                    </Label>
                    <Input
                      id="ctl-key"
                      className="mt-1"
                      type="password"
                      autoComplete="off"
                      value={form.apiKey}
                      disabled={busy !== null}
                      onChange={(e) => set({ apiKey: e.target.value })}
                    />
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Si crea sulla console UniFi, nell&apos;app Network: Control Plane, poi Integrazioni.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="ctl-user" className="text-[13px] text-muted-foreground">
                          {isUdm ? "Utente locale" : "Utente"}
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
                          value={form.password}
                          disabled={busy !== null}
                          onChange={(e) => set({ password: e.target.value })}
                        />
                      </div>
                    </div>
                    {isUdm && (
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        Account locale della console, senza verifica in due passaggi; serve almeno la lettura
                        dell&apos;app Network.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-muted-foreground">
                    Si salva nell&apos;archivio come «{nomeVoceNuova(form)}».
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setTarget({ nuova: false })}
                  >
                    Scegli dall&apos;archivio
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-1 space-y-1.5">
                <div className="flex gap-2">
                  <Select
                    // Finché le voci non ci sono il trigger mostrerebbe l'id grezzo: si vede il segnaposto.
                    value={voci === null || scelta === null ? null : String(scelta)}
                    disabled={busy !== null || voci === null || ammesse.length === 0}
                    onValueChange={(v) => v && setTarget({ credentialId: Number(v) })}
                  >
                    <SelectTrigger id="ctl-cred" className="w-full min-w-0" aria-invalid={sceltaDaRifare || undefined}>
                      <SelectValue placeholder={vociPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {ammesse.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() => setTarget({ nuova: true })}
                  >
                    Nuova nell&apos;archivio
                  </Button>
                </div>
                {sceltaDaRifare && (
                  <p role="alert" className="text-[13px] text-destructive">
                    L&apos;indirizzo è cambiato: scegli di nuovo la credenziale.
                  </p>
                )}
                {vociError && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    <span>Impossibile caricare le voci dell&apos;archivio: {vociError}</span>
                    <Button variant="outline" size="sm" onClick={() => void loadVoci()}>
                      Riprova
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

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
