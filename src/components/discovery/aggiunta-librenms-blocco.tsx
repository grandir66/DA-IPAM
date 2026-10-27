"use client";

/**
 * Aggiunta in blocco a LibreNMS dalla Discovery (tavola `docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`,
 * oggetti 8-9): la stessa rotta di una sola aggiunta, un oggetto alla volta, mai forzata; una riga per oggetto con l'esito.
 * Chiudere la finestra ferma la coda dopo l'oggetto in corso; le aggiunte fatte restano.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { esitoRigaLibrenms, type EsitoRigaLibrenms } from "@/lib/integrations/librenms-blocco";

export interface OggettoBlocco { id: number; nome: string; ip: string }

type StatoRiga = EsitoRigaLibrenms | { stato: "attesa" } | { stato: "in_corso" };

/** Segno, parola e tinta per luminanza: verde pieno, ambra a righe, grigio chiaro (Riccardo è daltonico). */
const PASTIGLIA: Record<StatoRiga["stato"], { segno: string; testo: string; classe: string }> = {
  aggiunto: { segno: "✓", testo: "aggiunto", classe: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]" },
  gia_presente: { segno: "✓", testo: "già presente, aggiornato", classe: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]" },
  rifiutato: { segno: "▲", testo: "rifiutato", classe: "bg-[repeating-linear-gradient(135deg,#E69F00_0_6px,#F3C25A_6px_10px)] text-[#0D2537]" },
  senza_snmp: { segno: "–", testo: "senza SNMP", classe: "bg-[#D0D8DC] text-[#0D2537] dark:bg-[#4A6070] dark:text-white" },
  errore: { segno: "✕", testo: "errore", classe: "bg-[#0D2537] text-white outline outline-2 -outline-offset-2 outline-[#E69F00] dark:bg-[#E6EEF4] dark:text-[#0D2537]" },
  in_corso: { segno: "◷", testo: "in corso…", classe: "bg-[#D0D8DC] text-[#0D2537] dark:bg-[#4A6070] dark:text-white" },
  attesa: { segno: "", testo: "in attesa", classe: "text-muted-foreground" },
};

export function AggiuntaLibrenmsBlocco({ oggetti, open, onOpenChange, onAggiunto }: {
  oggetti: OggettoBlocco[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Un oggetto entrato in LibreNMS (aggiunto o già presente): la pagina aggiorna la sua mappa. */
  onAggiunto: (id: number, librenmsDeviceId: number) => void;
}) {
  const [stati, setStati] = useState<StatoRiga[]>(() => oggetti.map(() => ({ stato: "attesa" })));
  const [fermato, setFermato] = useState(false);
  const ferma = useRef(false);
  const avviato = useRef(false);
  const avvisa = useRef(onAggiunto);
  avvisa.current = onAggiunto;

  useEffect(() => {
    // In sviluppo React monta l'effetto due volte: la pulizia della prima non deve fermare la coda già partita.
    ferma.current = false;
    if (avviato.current) return () => { ferma.current = true; };
    avviato.current = true;
    void (async () => {
      for (let i = 0; i < oggetti.length; i++) {
        if (ferma.current) break;
        setStati((s) => s.map((x, k) => (k === i ? { stato: "in_corso" } : x)));
        let esito: EsitoRigaLibrenms;
        try {
          const r = await fetch("/api/integrations/librenms/host", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host_id: oggetti[i].id }),
          });
          esito = esitoRigaLibrenms(r.status, await r.json().catch(() => null));
        } catch {
          esito = { stato: "errore", motivo: "Errore di rete" };
        }
        if (esito.stato === "aggiunto" || esito.stato === "gia_presente") avvisa.current(oggetti[i].id, esito.librenms_device_id);
        setStati((s) => s.map((x, k) => (k === i ? esito : x)));
      }
    })();
    return () => { ferma.current = true; };
  }, [oggetti]);

  const fatti = stati.filter((s) => s.stato !== "attesa" && s.stato !== "in_corso").length;
  const finito = fatti === oggetti.length || (fermato && !stati.some((s) => s.stato === "in_corso"));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) ferma.current = true; onOpenChange(v); }}>
      <DialogContent className="w-full sm:max-w-3xl">
        <DialogHeader className="border-b border-border/50 px-4 pb-3 pt-4">
          <DialogTitle>Aggiunta a LibreNMS · {fatti} di {oggetti.length}</DialogTitle>
          <DialogDescription>Uno alla volta, senza aggiunta forzata. Chiudendo la finestra le aggiunte già fatte restano.</DialogDescription>
          <div className="mt-2 h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={oggetti.length} aria-valuenow={fatti}>
            <div className="h-full bg-[#0D2537] dark:bg-sky-100" style={{ width: `${oggetti.length ? (fatti / oggetti.length) * 100 : 0}%` }} />
          </div>
        </DialogHeader>
        <DialogScrollableArea className="px-4 py-2">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Oggetto</th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">IP</th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Esito</th>
              </tr>
            </thead>
            <tbody>
              {oggetti.map((o, i) => {
                const s = stati[i];
                const p = PASTIGLIA[s.stato];
                return (
                  <tr key={o.id} className="border-b">
                    <td className="px-2 py-1.5 align-top">{o.nome}</td>
                    <td className="px-2 py-1.5 align-top font-mono">{o.ip}</td>
                    <td className="px-2 py-1.5 align-top">
                      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px font-semibold", p.classe)}>
                        {p.segno && <span aria-hidden>{p.segno}</span>}{p.testo}
                      </span>
                      {"motivo" in s && <span className="ml-2 break-words text-muted-foreground">{s.motivo}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DialogScrollableArea>
        <DialogFooter className="border-t border-border/50 px-4 py-3">
          {!finito && (
            <Button variant="outline" disabled={fermato} onClick={() => { ferma.current = true; setFermato(true); }}>
              {fermato ? "Si ferma dopo questo…" : "Ferma dopo questo"}
            </Button>
          )}
          <Button variant={finito ? "default" : "outline"} onClick={() => { ferma.current = true; onOpenChange(false); }}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
