"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Monitor } from "lucide-react";

interface IntegrationInfo {
  enabled: boolean;
  url: string;
  label: string;
}

interface ActiveIntegrations {
  librenms?: IntegrationInfo;
  graylog?: IntegrationInfo;
  loki?: IntegrationInfo;
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

      {/* iframe */}
      {current?.url && (
        <div className="flex-1 relative">
          <iframe
            key={selected}
            src={current.url}
            title={current.label}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
          {/* Overlay mostrato solo se l'iframe non carica (CSP/X-Frame-Options) */}
          <noscript>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/20">
              <p className="text-sm text-muted-foreground">
                {current.label} non può essere incorporato in un frame.
              </p>
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Apri {current.label}
              </a>
            </div>
          </noscript>
        </div>
      )}
    </div>
  );
}
