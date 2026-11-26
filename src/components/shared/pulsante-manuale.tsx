"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MarkdownViewer } from "@/components/manual/markdown-viewer";
import { fetchJson } from "@/lib/fetch-json";
import { useParteAperta } from "./parte-guida";

interface GuidaPagina {
  nome: string;
  titolo: string;
  versione: string;
  aggiornata: string;
  testo: string;
}

type Stato = { tipo: "carica" } | { tipo: "errore"; messaggio: string } | { tipo: "pronta"; guida: GuidaPagina | null };

function dataItaliana(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Il «?» in alto a destra di ogni pagina (Riccardo, 26/11/2026): apre la guida di quella pagina, letta da
 * `docs/manuale/pagine/`. Lo mette il guscio dell'app, quindi c'è dappertutto senza toccare le pagine. Se la pagina
 * dichiara la parte aperta (`useParteGuida`) o l'indirizzo ha un'àncora, la finestra scorre al paragrafo `{#parte}`.
 */
export function PulsanteManuale() {
  const percorso = usePathname() ?? "/";
  const parte = useParteAperta();
  const [aperta, setAperta] = useState(false);
  const [stato, setStato] = useState<Stato>({ tipo: "carica" });
  const corpo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aperta) return;
    const ac = new AbortController();
    setStato({ tipo: "carica" });
    fetchJson<{ guida: GuidaPagina | null }>(`/api/manuale/pagina?percorso=${encodeURIComponent(percorso)}`, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setStato(r.ok ? { tipo: "pronta", guida: r.data.guida } : { tipo: "errore", messaggio: r.message });
      });
    return () => ac.abort();
  }, [aperta, percorso]);

  useEffect(() => {
    if (stato.tipo !== "pronta" || !stato.guida) return;
    // La parte dichiarata dalla pagina, poi l'àncora dell'indirizzo, poi la scheda di Impostazioni (`?tab=`).
    const ancora = parte ?? (window.location.hash.slice(1) || new URLSearchParams(window.location.search).get("tab"));
    if (!ancora) return;
    const t = setTimeout(() => corpo.current?.querySelector(`[id="${CSS.escape(ancora)}"]`)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, [stato, parte]);

  return (
    <Dialog open={aperta} onOpenChange={setAperta}>
      <DialogTrigger
        aria-label="Manuale di questa pagina"
        title="Manuale di questa pagina"
        className="absolute right-3 top-3 z-20 flex size-8 items-center justify-center rounded-full border-2 border-foreground bg-card text-base font-bold text-foreground hover:bg-muted"
      >
        ?
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        {stato.tipo === "carica" && <p className="text-sm text-muted-foreground">Caricamento…</p>}
        {stato.tipo === "errore" && <p className="text-sm">✕ La guida non si è caricata: {stato.messaggio}</p>}
        {stato.tipo === "pronta" && !stato.guida && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Questa pagina non ha ancora la guida</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              Il manuale completo spiega il prodotto e tutte le voci del menu.{" "}
              <Link href="/manual" className="text-cian-testo underline" onClick={() => setAperta(false)}>Apri il manuale</Link>
            </p>
          </>
        )}
        {stato.tipo === "pronta" && stato.guida && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">{stato.guida.titolo}</DialogTitle>
              <p className="text-[13px] text-muted-foreground">
                {stato.guida.versione && `Aggiornata alla v${stato.guida.versione}`}
                {stato.guida.aggiornata && ` · ${dataItaliana(stato.guida.aggiornata)}`}
              </p>
            </DialogHeader>
            <div ref={corpo}>
              <MarkdownViewer content={stato.guida.testo} />
            </div>
            <div className="border-t pt-3 text-right text-sm">
              <Link href={`/manual?doc=pagina__${stato.guida.nome}`} className="text-cian-testo underline" onClick={() => setAperta(false)}>
                Apri nel manuale completo →
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
