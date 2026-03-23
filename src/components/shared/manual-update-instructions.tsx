"use client";

import { Terminal, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SCRIPT_SNIPPET = `export DA_INVENT_DIR=/opt/da-invent
cd "$DA_INVENT_DIR"
./scripts/update.sh --restart`;

const MANUAL_SNIPPET = `cd /opt/da-invent
git pull
npm install
npm run build
sudo systemctl restart da-invent`;

function CopySnippetButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1 text-xs shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          toast.success("Comandi copiati negli appunti");
        });
      }}
    >
      <Copy className="h-3 w-3" />
      {label}
    </Button>
  );
}

function PreBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "text-[11px] leading-relaxed overflow-x-auto rounded-md border bg-background px-3 py-2.5 font-mono whitespace-pre-wrap break-all sm:break-normal sm:whitespace-pre",
        className
      )}
    >
      {children}
    </pre>
  );
}

type ManualUpdateInstructionsProps = {
  /** Più compatto per dialog/banner stretti */
  variant?: "default" | "compact";
  className?: string;
};

export function ManualUpdateInstructions({ variant = "default", className }: ManualUpdateInstructionsProps) {
  const tight = variant === "compact";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/30 text-left",
        tight ? "p-3 space-y-2.5" : "p-4 space-y-4",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Terminal className={cn("text-primary shrink-0 mt-0.5", tight ? "h-4 w-4" : "h-5 w-5")} />
        <div className="space-y-1 min-w-0">
          <p className={cn("font-medium", tight ? "text-sm" : "text-sm sm:text-base")}>
            Aggiornamento manuale da console
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Il controllo versione dalla UI può non coincidere con il codice sul server. Connettiti in SSH,
            vai nella directory dell&apos;installazione (es. <code className="text-[11px] bg-muted px-1 rounded">/opt/da-invent</code>)
            e usa uno dei due metodi seguenti.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Dopo <code className="text-[11px] bg-muted px-1 rounded">git pull</code> la versione è quella nel{" "}
            <code className="text-[11px] bg-muted px-1 rounded">package.json</code> del branch su{" "}
            <a
              href="https://github.com/grandir66/DA-IPAM/blob/main/package.json"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              GitHub (main)
            </a>
            . Se il numero non cambia, non è stato pubblicato un release più recente su quel branch (oppure il server è su un altro remote/branch).
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium">Script incluso nel repository (consigliato)</p>
          <CopySnippetButton text={SCRIPT_SNIPPET} label="Copia" />
        </div>
        <PreBlock>{SCRIPT_SNIPPET}</PreBlock>
        <p className="text-[11px] text-muted-foreground">
          Lo script esegue <code className="text-[10px] bg-muted px-1 rounded">git pull</code>,{" "}
          <code className="text-[10px] bg-muted px-1 rounded">npm install</code>,{" "}
          <code className="text-[10px] bg-muted px-1 rounded">npm run build</code> e, con{" "}
          <code className="text-[10px] bg-muted px-1 rounded">--restart</code>, riavvia il servizio systemd{" "}
          <code className="text-[10px] bg-muted px-1 rounded">da-invent</code> se attivo.
        </p>
      </div>

      <div className="space-y-2 pt-1 border-t border-border/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium">Comandi equivalenti (senza script)</p>
          <CopySnippetButton text={MANUAL_SNIPPET} label="Copia" />
        </div>
        <PreBlock>{MANUAL_SNIPPET}</PreBlock>
        <p className="text-[11px] text-muted-foreground">
          Adatta il percorso e il nome servizio se la tua installazione usa directory o unità systemd diverse.
          Come root puoi omettere <code className="text-[10px] bg-muted px-1 rounded">sudo</code>.
        </p>
      </div>
    </div>
  );
}
