"use client";

/**
 * URL pubblico dell'hub (`public_hub_url`): l'indirizzo con cui le macchine dei clienti
 * raggiungono questo hub (script d'installazione dell'agente d'inventario, link nei
 * messaggi). Qui stava anche l'elenco degli agenti Python remoti, tolti il 20/10/2026
 * (decisione 26 della spec NetBird: nessuno li usava); il riquadro resta allo stesso
 * indirizzo perché il Launchpad ci rimanda (`/agents#hub-url-config`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { Save, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface HubUrlInfo {
  public_hub_url: string;
  effective_url: string | null;
  source: "public_hub_url" | "none";
}

export default function HubUrlPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "superadmin";

  const [info, setInfo] = useState<HubUrlInfo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [publicHubUrl, setPublicHubUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<HubUrlInfo>("/api/settings/hub-url");
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setInfo(r.data);
    setPublicHubUrl(r.data.public_hub_url);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep-link dal Launchpad: /agents#hub-url-config evidenzia il riquadro.
  useEffect(() => {
    if (!info || window.location.hash !== "#hub-url-config") return;
    const el = cardRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2");
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 2200);
    return () => clearTimeout(t);
  }, [info]);

  const handleSave = async () => {
    const url = publicHubUrl.trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      toast.error("URL pubblico non valido (atteso https://host[:port])");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "public_hub_url", value: url }),
      });
      if (!res.ok) {
        toast.error("Errore nel salvataggio");
        return;
      }
      toast.success("URL pubblico dell'hub salvato.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {errore ? (
        <LoadError what="l'URL pubblico dell'hub" message={errore} onRetry={() => void load()} />
      ) : (
        <Card id="hub-url-config" ref={cardRef} className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              URL pubblico dell&apos;hub
            </CardTitle>
            <CardDescription>
              Indirizzo con cui le macchine dei clienti raggiungono questo hub (script d&apos;installazione
              dell&apos;agente d&apos;inventario). Vuoto: si usa l&apos;indirizzo da cui è aperta la pagina.
              Effettivo: <code className="font-mono">{info?.effective_url ?? "—"}</code>
            </CardDescription>
            <div className="space-y-3 max-w-2xl mt-4">
              <div className="space-y-2">
                <Label htmlFor="public-hub-url">URL pubblico</Label>
                <Input
                  id="public-hub-url"
                  placeholder="es. https://<nodo>.netbird.selfhosted"
                  value={publicHubUrl}
                  onChange={(e) => setPublicHubUrl(e.target.value)}
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Schema + host + (eventuale porta). Funziona da qualunque rete raggiunga l&apos;URL.
                </p>
              </div>
              {canEdit && (
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  Salva
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
