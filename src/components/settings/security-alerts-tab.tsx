"use client";

/**
 * Impostazioni della raccolta alert di sicurezza: cosa considerare un attacco.
 * Separata dalle notifiche, che riguardano invece come comunicarlo.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Siren } from "lucide-react";

interface AlertsConfigDto {
  selfIps: string[];
  selfAccounts: string[];
  deviceRuleIds: string[];
  retentionDays: number;
}

const toList = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function SecurityAlertsTab() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selfIps, setSelfIps] = useState("");
  const [selfAccounts, setSelfAccounts] = useState("");
  const [deviceRuleIds, setDeviceRuleIds] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/integrations/wazuh/alerts/config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as AlertsConfigDto;
        setSelfIps(d.selfIps.join(", "));
        setSelfAccounts(d.selfAccounts.join(", "));
        setDeviceRuleIds(d.deviceRuleIds.join(", "));
        setRetentionDays(d.retentionDays);
      } catch (e) {
        toast.error(`Errore nel caricamento: ${(e as Error).message}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/wazuh/alerts/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfIps: toList(selfIps),
          selfAccounts: toList(selfAccounts),
          deviceRuleIds: toList(deviceRuleIds),
          retentionDays: Number(retentionDays),
        }),
      });
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
        );
      }
      toast.success("Impostazioni salvate");
    } catch (e) {
      toast.error(`Errore nel salvataggio: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Caricamento…</div>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Cosa considerare un attacco e cosa no. Le impostazioni di invio (email,
        webhook, riepiloghi) stanno nel tab Notifiche.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Siren className="h-4 w-4" /> Reti e account nostri
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Quello che parte da noi non è un attacco. Gli IP dell&apos;appliance e gli
            account delle credenziali configurate vengono riconosciuti da soli: qui
            si aggiunge ciò che il sistema non può dedurre — reti aziendali, cloud,
            altri collector. Senza, le nostre sonde e le nostre sedi compaiono fra
            gli attaccanti.
          </p>
          <div>
            <Label htmlFor="selfIps">IP e reti nostri</Label>
            <Input
              id="selfIps"
              value={selfIps}
              onChange={(e) => setSelfIps(e.target.value)}
              placeholder="es. 95.230.196.128/28, 217.28.64.176/28, 51.89.15.24/29"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Indirizzi singoli o reti in notazione CIDR, separati da virgola. Una
              rete scritta a partire da un host viene normalizzata: 51.89.15.25/29
              vale .24–.31. Reti più ampie di 1024 indirizzi vengono ignorate.
            </p>
          </div>
          <div>
            <Label htmlFor="selfAccounts">Account di servizio nostri</Label>
            <Input
              id="selfAccounts"
              value={selfAccounts}
              onChange={(e) => setSelfAccounts(e.target.value)}
              placeholder="es. domarc, ospd-openvas, svc-scanner"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Riconosciuti in qualunque forma: &quot;DOMINIO\utente&quot; e
              &quot;utente@dominio&quot; valgono come &quot;utente&quot;.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regole degli apparati di rete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Alcuni decoder di apparati (MikroTik, firewall, VPN) non marcano i
            propri eventi come fallimenti di autenticazione: hanno solo il gruppo
            del produttore. Senza indicare gli ID delle loro regole, i tentativi
            falliti su quegli apparati restano invisibili.
          </p>
          <div>
            <Label htmlFor="deviceRuleIds">ID regole da raccogliere</Label>
            <Input
              id="deviceRuleIds"
              value={deviceRuleIds}
              onChange={(e) => setDeviceRuleIds(e.target.value)}
              placeholder="es. 100202, 100435"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Gli ID sono specifici della tua installazione Wazuh, non del
              prodotto: si leggono da <code>/var/ossec/etc/rules/local_rules.xml</code>.
              Il rimedio più duraturo è aggiungere{" "}
              <code>&lt;group&gt;authentication_failed&lt;/group&gt;</code> a quelle
              regole: così vengono riconosciute da sole, qui e altrove.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conservazione</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="retentionDays">Conserva gli eventi (giorni)</Label>
            <Input
              id="retentionDays"
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Vale solo per gli eventi presi in carico. Quelli ancora aperti non
              vengono mai cancellati, per quanto vecchi siano.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Salvataggio…" : "Salva"}
      </Button>
    </div>
  );
}
