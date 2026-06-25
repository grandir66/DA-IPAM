"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Upload, Database, AlertTriangle } from "lucide-react";

const TIER_OPTIONS: { value: string; label: string }[] = [
  { value: "config", label: "Configurazione (reti, impostazioni)" },
  { value: "asset", label: "Asset (host, device, subnet)" },
  { value: "history", label: "Storico (scan, log)" },
  { value: "mirror", label: "Mirror (DHCP, ARP, DNS)" },
];

export default function TransferPage() {
  // --- Export state ---
  const [expPass, setExpPass] = useState("");
  const [tiers, setTiers] = useState<string[]>(["asset", "mirror"]);
  const [includeVault, setIncludeVault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // --- Import state ---
  const [impPass, setImpPass] = useState("");
  const [impFile, setImpFile] = useState<File | null>(null);
  const [wipe, setWipe] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleTier(t: string) {
    setTiers((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    );
  }

  async function doExport() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tenant/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: expPass, tiers, includeVault }),
      });
      if (!res.ok) {
        const text = await res.text();
        setMsg({ text: "Errore export: " + text, ok: false });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const fname = cd.match(/filename="(.+?)"/)?.[1] ?? "tenant.dab";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ text: "Export completato: " + fname, ok: true });
    } catch (e) {
      setMsg({ text: "Errore di rete: " + (e instanceof Error ? e.message : String(e)), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!impFile) {
      setMsg({ text: "Seleziona un file .dab", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("bundle", impFile);
      fd.set("passphrase", impPass);
      fd.set("wipe", String(wipe));
      const res = await fetch("/api/tenant/import", { method: "POST", body: fd });
      if (!res.ok) {
        // Leggi il body UNA sola volta come testo, poi prova a estrarre .error se è JSON.
        const bodyText = await res.text();
        let errMsg = bodyText || res.statusText;
        try {
          errMsg = ((JSON.parse(bodyText) as { error?: string }).error) ?? errMsg;
        } catch {
          /* body non-JSON: tieni il testo grezzo */
        }
        setMsg({ text: "Errore import: " + errMsg, ok: false });
        return;
      }
      const json = await res.json();
      const r = json.result;
      const totalRows = r?.tables ? Object.values(r.tables).reduce<number>((a, b) => a + (b as number), 0) : 0;
      setMsg({ text: `Import completato: ${totalRows} righe, ${r?.rekeyedSecrets ?? 0} segreti ri-cifrati, ${r?.profilesMerged ?? 0} profili e ${r?.vaultMerged ?? 0} credenziali sistema uniti.`, ok: true });
    } catch (e) {
      setMsg({ text: "Errore di rete: " + (e instanceof Error ? e.message : String(e)), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trasferimento dati tenant</h1>
        <p className="text-muted-foreground mt-1">
          Esporta o importa la configurazione completa del tenant in un bundle cifrato (.dab).
          La passphrase scelta è necessaria per reimportare il bundle.
        </p>
      </div>

      {/* === Export === */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Export bundle</CardTitle>
          </div>
          <CardDescription>
            Genera un file .dab cifrato con i dati del tenant corrente.
            Seleziona i livelli da includere e imposta la passphrase di cifratura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="exp-pass">Passphrase di cifratura</Label>
            <Input
              id="exp-pass"
              type="password"
              placeholder="Minimo 8 caratteri"
              value={expPass}
              onChange={(e) => setExpPass(e.target.value)}
              autoComplete="new-password"
              className="max-w-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Livelli da esportare</Label>
            <div className="space-y-2 pl-1">
              {TIER_OPTIONS.map((t) => (
                <label
                  key={t.value}
                  className="flex items-center gap-3 text-sm cursor-pointer hover:text-foreground text-muted-foreground"
                >
                  <Checkbox
                    checked={tiers.includes(t.value)}
                    onCheckedChange={() => toggleTier(t.value)}
                  />
                  <span className={tiers.includes(t.value) ? "text-foreground font-medium" : ""}>
                    {t.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Opzioni aggiuntive</Label>
            <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-foreground text-muted-foreground pl-1">
              <Checkbox
                checked={includeVault}
                onCheckedChange={(checked) => setIncludeVault(checked === true)}
              />
              <span className={includeVault ? "text-foreground font-medium" : ""}>
                Includi vault credenziali di sistema (credenziali scan, API key, segreti moduli)
              </span>
            </label>
          </div>

          <Button
            onClick={() => void doExport()}
            disabled={busy || expPass.length < 8 || tiers.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {busy ? "Export in corso…" : "Esporta .dab"}
          </Button>
        </CardContent>
      </Card>

      {/* === Import === */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Import bundle</CardTitle>
          </div>
          <CardDescription>
            Carica un file .dab per ripristinare la configurazione nel tenant corrente.
            Usa la stessa passphrase dell&apos;export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="imp-file">File bundle (.dab)</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Database className="h-4 w-4" />
                {impFile ? impFile.name : "Scegli file…"}
              </Button>
              {impFile && (
                <span className="text-xs text-muted-foreground">
                  {(impFile.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                ref={fileInputRef}
                id="imp-file"
                type="file"
                accept=".dab"
                className="hidden"
                onChange={(e) => setImpFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="imp-pass">Passphrase del bundle</Label>
            <Input
              id="imp-pass"
              type="password"
              placeholder="Passphrase usata durante l'export"
              value={impPass}
              onChange={(e) => setImpPass(e.target.value)}
              autoComplete="current-password"
              className="max-w-sm"
            />
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/20 p-3 space-y-2">
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox
                checked={wipe}
                onCheckedChange={(checked) => setWipe(checked === true)}
                className="mt-0.5"
              />
              <div>
                <span className={wipe ? "font-medium text-amber-800 dark:text-amber-400" : "text-muted-foreground"}>
                  Svuota il tenant prima di importare (wipe-and-load)
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Elimina tutti i dati esistenti del tenant prima di caricare il bundle.
                  Usa solo se vuoi sovrascrivere completamente il tenant corrente.
                </p>
              </div>
            </label>
            {wipe && (
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Attenzione: i dati attuali del tenant verranno eliminati in modo permanente.
              </div>
            )}
          </div>

          <Button
            onClick={() => void doImport()}
            disabled={busy || !impFile || impPass.length < 8}
            variant={wipe ? "destructive" : "default"}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Import in corso…" : wipe ? "Importa .dab (con wipe)" : "Importa .dab"}
          </Button>
        </CardContent>
      </Card>

      {/* === Status message === */}
      {msg && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            msg.ok
              ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/20 text-green-800 dark:text-green-400"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
