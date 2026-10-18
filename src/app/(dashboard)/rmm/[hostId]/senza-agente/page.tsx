"use client";

/**
 * Desktop remoto SENZA agente (RDP o VNC) dentro DA-IPAM: stesso schema della
 * pagina con agente (`../page.tsx`), ma la sessione la apre il server
 * MeshCentral collegandosi lui all'IP dell'host. Logica in
 * `src/lib/integrations/meshcentral/senza-agente.ts`.
 *
 * Il protocollo arriva da `?p=rdp|vnc`. Ogni (ri)connessione chiede un URL
 * nuovo: il login-token della pagina RDP è monouso.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Protocollo = "rdp" | "vnc";

const ETICHETTA: Record<Protocollo, string> = {
  rdp: "Desktop remoto (RDP)",
  vnc: "VNC",
};

function SessioneSenzaAgente() {
  const params = useParams<{ hostId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const hostId = Number(params?.hostId);
  const protocollo: Protocollo = search?.get("p") === "vnc" ? "vnc" : "rdp";

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Iframe che non carica dopo qualche secondo: quasi sempre il certificato
  // self-signed di MeshCentral non ancora accettato dal browser (vedi ../page.tsx).
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameStuck, setFrameStuck] = useState(false);

  const chiediUrl = useCallback(async (): Promise<string | null> => {
    const r = await fetch(`/api/integrations/meshcentral/host/${hostId}/senza-agente`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocollo }),
    });
    const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !data.url) throw new Error(data.error ?? "Avvio sessione fallito");
    return data.url;
  }, [hostId, protocollo]);

  const apri = useCallback(async () => {
    if (!Number.isFinite(hostId)) return;
    setLoading(true);
    setError(null);
    try {
      setUrl(await chiediUrl());
    } catch (e) {
      setUrl(null);
      setError(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setLoading(false);
    }
  }, [hostId, chiediUrl]);

  useEffect(() => {
    void apri();
  }, [apri]);

  useEffect(() => {
    if (!url) return;
    setFrameLoaded(false);
    setFrameStuck(false);
    const t = setTimeout(() => setFrameStuck(true), 7000);
    return () => clearTimeout(t);
  }, [url]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/objects/${hostId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Torna all&apos;host
        </Button>
        <span className="font-medium">{ETICHETTA[protocollo]}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          senza agente, le credenziali si inseriscono nella sessione
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => void apri()} disabled={loading} title="Riconnetti">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {url ? (
            <Button
              size="sm"
              variant="ghost"
              title="Apri in una scheda separata"
              onClick={() => {
                // L'URL nell'iframe è già usato (token monouso): ne serve uno nuovo.
                void chiediUrl()
                  .then((u) => {
                    if (u) window.open(u, "_blank", "noopener,noreferrer");
                  })
                  .catch(() => undefined);
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex-1 bg-muted/30">
        {loading && !url ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Avvio sessione…
          </div>
        ) : null}

        {error && !url ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void apri()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Riprova
            </Button>
          </div>
        ) : null}

        {url ? (
          <iframe
            key={url}
            src={url}
            title={ETICHETTA[protocollo]}
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameLoaded(true)}
          />
        ) : null}

        {url && frameStuck && !frameLoaded ? (
          <div className="absolute inset-x-0 bottom-0 border-t bg-background/95 p-4 text-sm">
            <p className="font-medium">Il riquadro resta vuoto?</p>
            <p className="mt-1 text-muted-foreground">
              Probabilmente il browser non ha ancora accettato il certificato di MeshCentral:
              aprilo in una scheda, accetta l&apos;avviso, poi premi Riconnetti.
            </p>
            <div className="mt-2 flex gap-2">
              <a href={new URL(url).origin} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" /> Apri MeshCentral in una scheda
                </Button>
              </a>
              <Button size="sm" variant="ghost" onClick={() => void apri()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Riconnetti
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SessioneSenzaAgentePage() {
  return (
    <Suspense fallback={null}>
      <SessioneSenzaAgente />
    </Suspense>
  );
}
