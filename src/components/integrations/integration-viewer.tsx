"use client";

/**
 * Viewer in-app delle integrazioni con dashboard (LibreNMS / Graylog / Loki /
 * Wazuh). Estratto dall'ex-pagina /integrations per essere riusato dentro la
 * Launchpad come sezione collassabile. Alimentato da /api/integrations/active.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";

export interface IntegrationInfo {
  enabled: boolean;
  url: string;
  directUrl?: string;
  label: string;
  iframeNeedsHandshake?: boolean;
  handshakeReason?: string;
  iframeSupported?: boolean;
  shortcuts?: Array<{ label: string; url: string; description?: string }>;
}

export interface ActiveIntegrations {
  librenms?: IntegrationInfo;
  graylog?: IntegrationInfo;
  loki?: IntegrationInfo;
  wazuh?: IntegrationInfo;
}

export function IntegrationViewer() {
  const [integrations, setIntegrations] = useState<ActiveIntegrations>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/active")
      .then((r) => r.json())
      .then((d: ActiveIntegrations) => {
        setIntegrations(d);
        const first = Object.entries(d).find(([, v]) => v.enabled)?.[0] ?? null;
        setSelected(first);
      })
      .catch(() => {});
  }, []);

  const activeList = Object.entries(integrations).filter(([, v]) => v?.enabled);
  const current = selected ? integrations[selected as keyof ActiveIntegrations] : null;

  if (activeList.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Monitor className="h-4 w-4 text-muted-foreground" />
        Visualizza dashboard in-app
        <span className="text-xs text-muted-foreground font-normal">
          ({activeList.length} {activeList.length === 1 ? "integrazione" : "integrazioni"})
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border">
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
                href={current.directUrl ?? current.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Apri in nuova scheda
              </a>
            )}
          </div>

          {current?.iframeNeedsHandshake && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 text-xs flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Iframe potrebbe non caricarsi.</strong>{" "}
                {current.handshakeReason ??
                  "Apri prima in nuova tab per accettare il certificato/loggarti, poi ricarica."}{" "}
                <a
                  href={current.directUrl ?? current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Apri in nuova tab
                </a>
                .
              </div>
            </div>
          )}

          <div className="h-[70vh] flex flex-col">
            {current?.url && current.iframeSupported === false ? (
              <IntegrationLanding key={selected} info={current} />
            ) : current?.url ? (
              <IntegrationIframe
                key={selected}
                url={current.url}
                fallbackUrl={current.directUrl ?? current.url}
                label={current.label}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationLanding({ info }: { info: IntegrationInfo }) {
  const shortcuts = info.shortcuts ?? [];
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            {info.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {"L'integrazione "}
            <strong>{info.label}</strong>
            {" è attiva ma il dashboard SPA non può essere mostrato in iframe sotto sub-path proxy. Apri le viste qui sotto in una nuova tab."}
          </p>
        </div>

        {shortcuts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shortcuts.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-border bg-card hover:bg-accent transition-colors p-3 flex items-start gap-3 group"
              >
                <ExternalLink className="h-4 w-4 mt-0.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.label}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationIframe({
  url,
  fallbackUrl,
  label,
}: {
  url: string;
  fallbackUrl: string;
  label: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoadFailed(false);
    setShowFallback(false);
    const t = setTimeout(() => {
      if (iframeRef.current) {
        try {
          const doc = iframeRef.current.contentDocument;
          if (!doc) setShowFallback(true);
        } catch {
          /* cross-origin: normale */
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
        onLoad={() => {
          setLoadFailed(false);
          setShowFallback(false);
        }}
        onError={() => setLoadFailed(true)}
      />
      {(loadFailed || showFallback) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur">
          <ShieldAlert className="h-10 w-10 text-amber-500" />
          <div className="text-center max-w-md">
            <p className="text-sm font-medium">
              L&apos;iframe verso <strong>{label}</strong> non si è caricato.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Possibili cause: cert self-signed da accettare, header X-Frame-Options/CSP, o
              sessione non autenticata. Apri il servizio in nuova tab e ritenta.
            </p>
          </div>
          <a
            href={fallbackUrl}
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
