"use client";

/**
 * La chiave di scrittura del centro (13/11/2026, tappa C di DATIA MONITORING): serve solo
 * a «Metti in monitoraggio». Si scrive una volta, non si rilegge; si toglie da sola senza
 * toccare la lettura. Senza questa chiave il pulsante sulla scheda dell'apparato non c'è.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/fetch-json";
import type { ConfigScrittura } from "@/lib/zabbix-lettura/config";

export function ZabbixScritturaRiga() {
  const [config, setConfig] = useState<ConfigScrittura | null | undefined>(undefined);
  const [chiave, setChiave] = useState("");
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<{ config: ConfigScrittura | null }>("/api/zabbix/scrittura", { cache: "no-store" });
    setConfig(r.ok ? r.data.config : null);
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  async function salva() {
    setSalvo(true);
    const r = await fetchJson<{ config: ConfigScrittura }>("/api/zabbix/scrittura", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chiave }),
    });
    setSalvo(false);
    if (!r.ok) return void toast.error(r.message);
    setChiave("");
    setConfig(r.data.config);
    toast.success("Chiave di scrittura salvata");
  }

  async function togli() {
    const r = await fetchJson<{ tolta: boolean }>("/api/zabbix/scrittura", { method: "DELETE" });
    if (!r.ok) return void toast.error(r.message);
    setConfig(null);
    toast.success("Chiave di scrittura tolta: da qui non si mettono più oggetti in monitoraggio");
  }

  if (config === undefined) return null;
  return (
    <div className="space-y-1.5 border-t pt-4">
      <Label htmlFor="zbx-chiave-scrittura">Chiave di scrittura (facoltativa)</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="zbx-chiave-scrittura"
          className="max-w-md"
          type="password"
          autoComplete="off"
          placeholder={config ? `zs1.${config.chiaveId}.… (salvata)` : "zs1.<id>.<segreto>"}
          value={chiave}
          onChange={(e) => setChiave(e.target.value)}
        />
        <Button variant="outline" onClick={() => void salva()} disabled={salvo || !chiave.trim()}>
          {salvo && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Salva la chiave
        </Button>
        {config && (
          <Button variant="ghost" onClick={() => void togli()}>
            Togli la chiave
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Serve solo a «Metti in monitoraggio» dalla scheda dell&apos;apparato. La emette DA-Link, è diversa da quella di
        lettura e può solo aggiungere apparati in Zabbix: non cancella e non modifica niente.
      </p>
    </div>
  );
}
