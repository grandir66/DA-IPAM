"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CodeCopyBlockProps = {
  /** Testo copiato negli appunti (newline preservati) */
  code: string;
  title?: string;
  className?: string;
};

/**
 * Blocco comando monospazio con copia: usa sempre `whitespace-pre` così i caporiga
 * restano visibili e nella clipboard.
 */
export function CodeCopyBlock({ code, title, className }: CodeCopyBlockProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {title ? <p className="text-xs font-medium text-muted-foreground">{title}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <pre
          className="min-w-0 flex-1 text-[11px] leading-relaxed overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5 font-mono whitespace-pre text-left"
        >
          <code>{code}</code>
        </pre>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 text-xs self-start"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              toast.success("Comandi copiati negli appunti");
            });
          }}
        >
          <Copy className="h-3 w-3" />
          Copia
        </Button>
      </div>
    </div>
  );
}
