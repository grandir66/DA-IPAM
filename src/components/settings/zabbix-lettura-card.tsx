"use client";

/**
 * Configurazione del pannello Zabbix in sola lettura (passo 7.4). Indirizzo del
 * centro (raggiunto via NetBird), chiave di lettura (`zl1.…`, scritta una volta e mai
 * più mostrata), impronta TLS facoltativa, codice cliente. La verifica TLS non ha un
 * interruttore: o catena e nome, o l'impronta.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import type { ConfigLettura } from "@/lib/zabbix-lettura/config";
import type { ProxyLocale } from "@/lib/zabbix-lettura/pannello";

interface RispostaConfig {
  acquistato: boolean;
  config: ConfigLettura | null;
  codcliSuggerito: string | null;
  proxyLocale: ProxyLocale;
}

function quando(iso: string | null): string {
  if (!iso) return "mai";
  const d = parseDbDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT");
}

export function ZabbixLetturaCard({ isAdmin }: { isAdmin: boolean }) {
  const [dati, setDati] = useState<RispostaConfig | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [chiave, setChiave] = useState("");
  const [impronta, setImpronta] = useState("");
  const [codcli, setCodcli] = useState("");
  const [proxy, setProxy] = useState("");
  const [acceso, setAcceso] = useState(true);
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    if (!isAdmin) return;
    const r = await fetchJson<RispostaConfig>("/api/zabbix/config", { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setDati(r.data);
    const c = r.data.config;
    setBaseUrl(c?.baseUrl ?? "");
    setImpronta(c?.impronta ?? "");
    setCodcli(c?.codcli ?? r.data.codcliSuggerito ?? "");
    setProxy(c?.proxyLocale ?? "");
    setAcceso(c?.enabled ?? true);
    setChiave("");
  }, [isAdmin]);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function salva() {
    setSalvo(true);
    try {
      const r = await fetchJson<{ ok: true }>("/api/zabbix/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          chiave: chiave || null,
          impronta: impronta || null,
          codcli,
          proxyLocale: proxy || null,
          enabled: acceso,
        }),
      });
      if (r.ok) {
        toast.success("Pannello Zabbix salvato");
        await carica();
      } else {
        toast.error(`Errore: ${r.message}`);
      }
    } finally {
      setSalvo(false);
    }
  }

  async function togli() {
    if (!window.confirm("Togliere la configurazione del pannello Zabbix? La chiave di lettura salvata si cancella.")) return;
    const r = await fetchJson<{ ok: true }>("/api/zabbix/config", { method: "DELETE" });
    if (r.ok) {
      toast.success("Configurazione tolta");
      await carica();
    } else toast.error(`Errore: ${r.message}`);
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        La configurazione la vede solo un amministratore.{" "}
        <Link href="/zabbix" className="underline underline-offset-2">
          Apri il pannello
        </Link>
      </p>
    );
  }
  if (errore) return <LoadError what="la configurazione Zabbix" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!dati.acquistato) {
    return <p className="text-sm text-muted-foreground">Modulo opzionale non compreso in questa installazione.</p>;
  }

  const c = dati.config;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#00A7E7]" />
          Pannello Zabbix (sola lettura)
        </CardTitle>
        <CardDescription>
          Host, disponibilità, problemi e misure che il centro di monitoraggio conosce per questo cliente. Senza
          configurazione, o spento, nessuna richiesta parte verso il centro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="zbx-base">Indirizzo del centro</Label>
            <Input
              id="zbx-base"
              placeholder="https://centro-zabbix.example/wizard"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Solo https. Di norma l&apos;indirizzo del centro sull&apos;overlay NetBird.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zbx-chiave">Chiave di lettura</Label>
            <Input
              id="zbx-chiave"
              type="password"
              autoComplete="off"
              placeholder={c ? `zl1.${c.chiaveId}.… (salvata: lascia vuoto per non cambiarla)` : "zl1.<id>.<segreto>"}
              value={chiave}
              onChange={(e) => setChiave(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Cifrata nel database del cliente, non si rilegge.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zbx-impronta">Impronta del certificato (facoltativa)</Label>
            <Input
              id="zbx-impronta"
              placeholder="sha256//… oppure AB:CD:… (SHA-256)"
              value={impronta}
              onChange={(e) => setImpronta(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vuota: certificato firmato da un&apos;autorità fidata e col nome giusto. Con l&apos;impronta: solo quel
              certificato. La verifica non si spegne.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zbx-codcli">Codice cliente</Label>
            <Input id="zbx-codcli" inputMode="numeric" value={codcli} onChange={(e) => setCodcli(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Le risposte per un altro codice sono un guasto («cliente errato»).
              {!c && dati.codcliSuggerito && " Proposto dalla configurazione di DA-Link."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zbx-proxy">Nome del proxy di questa macchina (facoltativo)</Label>
            <Input
              id="zbx-proxy"
              placeholder={dati.proxyLocale.nome ?? "letto dal file del proxy"}
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={acceso} onCheckedChange={setAcceso} />
            <span className="text-sm">{acceso ? "Acceso" : "Spento (nessuna richiesta)"}</span>
          </div>
        </div>
        {c && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>
              Ultima lettura buona: {quando(c.ultimaLetturaOk)}
              {c.fallimenti > 0 && ` · ${c.fallimenti} tentativi falliti di fila, prossimo ${quando(c.prossimoTentativo)}`}
            </p>
            {c.ultimoErrore && <p>Ultimo errore: {c.ultimoErrore}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void salva()} disabled={salvo || !baseUrl || !codcli || (!c && !chiave)}>
            {salvo && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Salva
          </Button>
          {c && (
            <Button variant="outline" nativeButton={false} render={<Link href="/zabbix" />}>
              Apri il pannello
            </Button>
          )}
          {c && (
            <Button variant="ghost" onClick={() => void togli()}>
              Togli la configurazione
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
