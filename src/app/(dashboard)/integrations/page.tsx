"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, ShieldAlert } from "lucide-react";

interface IntegrationInfo {
  enabled: boolean;
  url: string;
  label: string;
  iframeNeedsHandshake?: boolean;
  handshakeReason?: string;
}

interface ActiveIntegrations {
  librenms?: IntegrationInfo;
  graylog?: IntegrationInfo;
  loki?: IntegrationInfo;
  wazuh?: IntegrationInfo;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<ActiveIntegrations>({});
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/active")
      .then((r) => r.json())
      .then((d: ActiveIntegrations) => {
        setIntegrations(d);
        // Seleziona automaticamente la prima integrazione abilitata
        const first = Object.entries(d).find(([, v]) => v.enabled)?.[0] ?? null;
        setSelected(first);
      })
      .catch(() => {});
  }, []);

  const activeList = Object.entries(integrations).filter(([, v]) => v.enabled);
  const current = selected ? integrations[selected as keyof ActiveIntegrations] : null;

  if (activeList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Monitor className="h-12 w-12 opacity-30" />
        <p className="text-lg">Nessuna integrazione attiva</p>
        <p className="text-sm">Configura LibreNMS o Graylog in Impostazioni → Integrazioni</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col -mx-2 -my-2 md:-mx-3 md:-my-3" style={{ height: "calc(100vh - 49px)" }}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border shrink-0">
        {activeList.map(([key, info]) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 transition-colors ${
              selected === key
                ? "bg-background border-border text-foreground -mb-px"
                : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {info.label}
          </button>
        ))}
        {current?.url && (
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Apri in nuova scheda
          </a>
        )}
      </div>

      {/* Banner handshake (cert self-signed, cookie cross-site, ecc.) */}
      {current?.iframeNeedsHandshake && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 text-xs flex items-start gap-2 shrink-0">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>Iframe potrebbe non caricarsi.</strong>{" "}
            {current.handshakeReason ?? "Apri prima in nuova tab per accettare il certificato/loggarti, poi ricarica questa pagina."}
            {" "}
            <a href={current.url} target="_blank" rel="noopener noreferrer" className="underline font-medium">
              Apri in nuova tab
            </a>
            .
          </div>
        </div>
      )}

      {/* iframe */}
      {current?.url && <IntegrationIframe key={selected} url={current.url} label={current.label} />}
    </div>
  );
}

function IntegrationIframe({ url, label }: { url: string; label: string }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoadFailed(false);
    setShowFallback(false);
    // Se entro 6 secondi non riceviamo onLoad, mostriamo il fallback
    // (succede quando il browser blocca per X-Frame-Options / connection refused / cert error).
    const t = setTimeout(() => {
      if (iframeRef.current) {
        try {
          // Tentativo di accedere al contentDocument: se same-origin e bloccato → eccezione catturabile
          const doc = iframeRef.current.contentDocument;
          if (!doc) setShowFallback(true);
        } catch {
          // Cross-origin (normale): non possiamo sapere se ha caricato, ma lasciamo perdere
        }
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [url]);

  return (
    <div className="flex-1 relative">
      <iframe
        ref={iframeRef}
        src={url}
        title={label}
        className="w-full h-full border-0"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        onLoad={() => { setLoadFailed(false); setShowFallback(false); }}
        onError={() => setLoadFailed(true)}
      />
      {(loadFailed || showFallback) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur">
          <ShieldAlert className="h-10 w-10 text-amber-500" />
          <div className="text-center max-w-md">
            <p className="text-sm font-medium">L&apos;iframe verso <strong>{label}</strong> non si è caricato.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Possibili cause: cert self-signed da accettare, header X-Frame-Options/CSP che blocca l&apos;embedding,
              o sessione non ancora autenticata. Apri il servizio in nuova tab e ritenta.
            </p>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Apri {label} in nuova tab
          </a>
        </div>
      )}
    </div>
  );
}
