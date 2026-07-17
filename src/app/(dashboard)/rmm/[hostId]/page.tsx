"use client";

/**
 * Sessione remota INCORPORATA in DA-IPAM.
 *
 * Il controllo remoto vive dentro la nostra UI invece di aprire la console
 * MeshCentral: i pulsanti (Desktop / Terminale / File) sono nostri, MeshCentral
 * fornisce solo i pixel dentro l'iframe.
 *
 * PERCHE' UN IFRAME E NON UN CLIENT NATIVO: il flusso video/tastiera/mouse viaggia
 * su `meshrelay.ashx` con un protocollo KVM proprietario (tile compresse, binario)
 * che MeshCentral non pubblica come API stabile. Riscriverlo significherebbe
 * mantenere per sempre un reverse-engineering che si rompe a ogni update — cioe'
 * l'opposto del motivo per cui si e' scelto MeshCentral invece di un agente
 * proprio. L'iframe da' lo stesso risultato visivo con una superficie di rottura
 * minima. Dati e comandi, invece, restano nativi via control.ashx.
 *
 * Serve `allowedFramingOrigins` su MeshCentral (vedi modules/meshcentral.sh):
 * autorizza SOLO l'origine di DA-IPAM via CSP frame-ancestors, senza disattivare
 * la protezione anti-clickjacking per tutti come farebbe `AllowFraming: true`.
 *
 * Il login-token e' MONOUSO e dura 3 minuti: si conia alla bisogna e si passa
 * all'iframe una sola volta. Ogni cambio di modalita' → nuovo token, nuovo mount
 * (da qui la `key` sull'iframe: senza, React riusa il nodo e l'URL non ricarica).
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  Monitor,
  RefreshCw,
  TerminalSquare,
  ExternalLink,
  SquareChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPanel } from "@/components/rmm/command-panel";
import { Badge } from "@/components/ui/badge";

/**
 * Modalita' della sessione. I viewmode 11/12/13 sono di MeshCentral e vivono
 * nell'iframe; "cmd" e' NOSTRA — pannello nativo via control.ashx, nessun iframe.
 */
const MODES = [
  { id: 11, label: "Desktop", icon: Monitor },
  { id: 12, label: "Terminale", icon: TerminalSquare },
  { id: 13, label: "File", icon: FolderOpen },
  { id: "cmd", label: "Comandi", icon: SquareChevronRight },
] as const;

type Mode = (typeof MODES)[number]["id"];

interface MeshStatus {
  present: boolean;
  nodeId?: string;
  name?: string | null;
  rname?: string | null;
  conn?: number;
  osdesc?: string | null;
}

export default function RemoteSessionPage() {
  const params = useParams<{ hostId: string }>();
  const router = useRouter();
  const hostId = Number(params?.hostId);

  const [mode, setMode] = useState<Mode>(11);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(hostId)) return;
    let active = true;
    fetch(`/api/integrations/meshcentral/host/${hostId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mesh?: MeshStatus } | null) => {
        if (active) setStatus(d?.mesh ?? { present: false });
      })
      .catch(() => {
        if (active) setStatus({ present: false });
      });
    return () => {
      active = false;
    };
  }, [hostId]);

  /** Conia un token fresco e (ri)monta l'iframe. */
  const openSession = useCallback(
    async (viewmode: number) => {
      if (!Number.isFinite(hostId)) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/integrations/meshcentral/host/${hostId}/remote-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewmode }),
        });
        const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!r.ok || !data.url) {
          const msg = data.error ?? "Avvio sessione remota fallito";
          setError(msg);
          toast.error(msg);
          return;
        }
        setUrl(data.url);
      } catch {
        setError("Errore di rete");
        toast.error("Errore di rete");
      } finally {
        setLoading(false);
      }
    },
    [hostId],
  );

  // Prima apertura + cambio modalita': ogni volta serve un token nuovo (monouso).
  // "cmd" e' nativa: nessun token, nessun iframe, nessuna chiamata a MeshCentral.
  useEffect(() => {
    if (typeof mode !== "number") return;
    void openSession(mode);
  }, [mode, openSession]);

  const online = status?.conn === 1;
  const title = status?.rname ?? status?.name ?? `Host ${hostId}`;

  if (status && !status.present) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/rmm")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Torna all&apos;elenco
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">
          Nessun agente MeshCentral associato a questo host: installa l&apos;agente dalla
          scheda host, oppure associalo manualmente da /rmm se il nodo esiste gia&apos;.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Barra comandi: e' DA-IPAM, non MeshCentral. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/rmm")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Indietro
        </Button>

        <span className="font-medium">{title}</span>
        <Badge variant={online ? "default" : "secondary"}>
          {online ? "online" : "offline"}
        </Badge>
        {status?.osdesc ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">{status.osdesc}</span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <Button
                key={m.id}
                size="sm"
                variant={mode === m.id ? "default" : "outline"}
                onClick={() => {
                  if (mode !== m.id) { setMode(m.id); return; }
                  // Ri-click sulla modalita' attiva = riconnetti. "cmd" e' nativa: niente token.
                  if (typeof m.id === "number") void openSession(m.id);
                }}
                disabled={loading && typeof m.id === "number"}
              >
                <Icon className="mr-2 h-4 w-4" />
                {m.label}
              </Button>
            );
          })}
          {typeof mode === "number" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openSession(mode)}
            disabled={loading}
            title="Il token dura 3 minuti: se la sessione scade, riconnetti"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          ) : null}
          {url && typeof mode === "number" ? (
            <Button
              size="sm"
              variant="ghost"
              title="Apri in una scheda separata"
              onClick={() => {
                // Token gia' consumato dall'iframe: ne serve uno nuovo.
                void (async () => {
                  const r = await fetch(
                    `/api/integrations/meshcentral/host/${hostId}/remote-session`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ viewmode: mode }),
                    },
                  );
                  const d = (await r.json().catch(() => ({}))) as { url?: string };
                  if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
                })();
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* I pixel: unica parte servita da MeshCentral. */}
      <div className="relative flex-1 bg-muted/30">
        {mode === "cmd" ? (
          /* Modalita' NATIVA: nessun iframe, nessun token, nessuna pagina
             MeshCentral. Passa da control.ashx, che e' un'API stabile. */
          <CommandPanel
            hostId={hostId}
            isWindows={/windows/i.test(status?.osdesc ?? "")}
          />
        ) : (
          <>
            {loading && !url ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Avvio sessione…
              </div>
            ) : null}

            {error && !url ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void openSession(mode)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Riprova
                </Button>
              </div>
            ) : null}

            {url ? (
              <iframe
                // key: forza il rimontaggio a ogni nuovo token. Senza, React riusa il
                // nodo e cambiare src non ricarica in modo affidabile.
                key={url}
                src={url}
                title={`Sessione remota — ${title}`}
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
