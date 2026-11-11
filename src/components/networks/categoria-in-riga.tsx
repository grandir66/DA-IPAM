"use client";

/**
 * La categoria di una riga, da scegliere lì: un clic sulla cella apre `ScegliCategoria` in un popover.
 * La usano le liste (Discovery) e il modulo «Modifica in blocco».
 */
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScegliCategoria } from "@/components/networks/scegli-categoria";
import type { VoceScelta } from "@/lib/classification/scelta-categoria";

export function CategoriaInRiga({
  children,
  attuale,
  proposta,
  extra,
  disabled,
  title,
  className,
  onScegli,
  onAutomatica,
}: {
  /** Quello che la cella mostra: è anche il pulsante che apre la scelta. */
  children: ReactNode;
  attuale?: string | null;
  proposta?: string | null;
  extra?: readonly VoceScelta[];
  disabled?: boolean;
  title?: string;
  className?: string;
  onScegli: (slug: string) => void | Promise<void>;
  onAutomatica?: () => void | Promise<void>;
}) {
  const [aperto, setAperto] = useState(false);
  return (
    <Popover open={aperto} onOpenChange={setAperto}>
      <PopoverTrigger
        disabled={disabled}
        render={<button type="button" title={title} className={className ?? "rounded-md text-left disabled:opacity-50"} onClick={(e) => e.stopPropagation()} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()}>
        <ScegliCategoria
          attuale={attuale}
          proposta={proposta}
          extra={extra}
          onScegli={(slug) => { setAperto(false); void onScegli(slug); }}
          onAutomatica={onAutomatica ? () => { setAperto(false); void onAutomatica(); } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
