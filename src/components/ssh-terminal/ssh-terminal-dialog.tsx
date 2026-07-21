"use client";

/**
 * Terminale SSH interattivo (xterm) in un dialog. Ottiene un token effimero da
 * /api/ssh-terminal/token, apre un WebSocket verso /ws/ssh (gestito in server.ts)
 * e collega xterm ↔ shell SSH. Le credenziali non lasciano mai il server.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SshTerminalDialog({
  hostId,
  hostLabel,
  open,
  onOpenChange,
}: {
  hostId: number;
  hostLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Ref-callback con stato: con il Dialog (portal + animazione) il div può montare
  // DOPO il primo run dell'effetto; usando uno stato l'effetto rigira quando il
  // container è disponibile (altrimenti restava "connessione…" per sempre).
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    if (!open || !container) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: { background: "#0b1220" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* noop */
    }

    const sendResize = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    (async () => {
      setStatus("connecting");
      try {
        const r = await fetch("/api/ssh-terminal/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId }),
        });
        const data = (await r.json().catch(() => null)) as
          | { token?: string; host?: string; username?: string; error?: string }
          | null;
        if (!r.ok || !data?.token) throw new Error(data?.error ?? `HTTP ${r.status}`);
        if (disposed) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(
          `${proto}//${window.location.host}/ws/ssh?token=${encodeURIComponent(data.token)}`,
        );
        ws.onopen = () => {
          setStatus("open");
          sendResize();
          term.focus();
        };
        ws.onmessage = (ev) => term.write(typeof ev.data === "string" ? ev.data : "");
        ws.onclose = () => {
          setStatus("closed");
          if (!disposed) term.write("\r\n\r\n[sessione chiusa]\r\n");
        };
        ws.onerror = () => {
          if (!disposed) term.write("\r\n[errore WebSocket]\r\n");
        };

        term.onData((d) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data: d }));
          }
        });
        term.onResize(sendResize);
      } catch (err) {
        if (!disposed) {
          toast.error(err instanceof Error ? err.message : "Errore apertura terminale");
          term.write(`\r\n[${err instanceof Error ? err.message : "errore"}]\r\n`);
          setStatus("closed");
        }
      }
    })();

    const refit = () => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
    };
    window.addEventListener("resize", refit);
    // Il dialog si apre in animazione (container 0px → dimensione finale): rifitta
    // quando il container prende le sue misure, altrimenti xterm resta a 0 colonne.
    const ro = new ResizeObserver(() => refit());
    ro.observe(container);

    return () => {
      disposed = true;
      window.removeEventListener("resize", refit);
      ro.disconnect();
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      term.dispose();
    };
  }, [open, hostId, container]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Terminale SSH — {hostLabel}
            {status === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}
            <span
              className={`ml-auto text-xs font-normal ${
                status === "open"
                  ? "text-emerald-500"
                  : status === "connecting"
                    ? "text-amber-500"
                    : "text-rose-500"
              }`}
            >
              {status === "open" ? "connesso" : status === "connecting" ? "connessione…" : "chiuso"}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div
          ref={setContainer}
          className="h-[65vh] w-full overflow-hidden rounded-md border bg-[#0b1220] p-2"
        />
      </DialogContent>
    </Dialog>
  );
}
