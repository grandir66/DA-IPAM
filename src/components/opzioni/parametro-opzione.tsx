"use client";

/**
 * Il valore di un parametro in Opzioni (tavola del 22/10, oggetti 15, 17, 18, 19). Numero e testo si cambiano nella
 * riga e si salvano uscendo dal campo o con Invio; un elenco si apre in una finestra (caselle se ha le scelte, una voce per
 * riga se no); un valore fisso ha il lucchetto. Un valore rifiutato resta scritto nel campo, col bordo rosso e il motivo:
 * non si perde quello che si è digitato.
 */
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { VoceOpzione } from "@/lib/opzioni/tipi";

/** Salva il valore; restituisce il motivo del rifiuto, o null se è andato. */
export type SalvaParametro = (corpo: { valore?: string; diSerie?: true }) => Promise<string | null>;

const CAMPO =
  "rounded-lg border bg-white px-2 py-1 text-[15px] text-[#0D2537] disabled:opacity-70 dark:bg-transparent dark:text-[#E6EEF4]";

/** Il testo del pulsante di un elenco: «elenco di serie», «41 porte», «2 categorie». */
export function etichettaElenco(v: VoceOpzione): string {
  const voci = (v.stato.valore ?? "").split(",").filter(Boolean);
  if (!v.stato.cambiato) return v.scelte ? `${voci.length} ${voci.length === 1 ? "categoria" : "categorie"}` : "elenco di serie";
  if (v.scelte) return `${voci.length} ${voci.length === 1 ? "categoria" : "categorie"}`;
  return `${voci.length} ${voci.length === 1 ? "porta" : "porte"}`;
}

export function CampoParametro({
  voce,
  puoCambiare,
  inCorso,
  errore,
  onSalva,
  onApriElenco,
}: {
  voce: VoceOpzione;
  puoCambiare: boolean;
  inCorso: boolean;
  errore: string | null;
  onSalva: SalvaParametro;
  onApriElenco: () => void;
}) {
  const valore = voce.stato.valore ?? "";
  const [bozza, setBozza] = useState(valore);
  // Il valore riletto dal server vince sulla bozza, salvo che la bozza sia stata rifiutata (resta da correggere).
  useEffect(() => {
    if (!errore) setBozza(valore);
  }, [valore, errore]);

  const unita = voce.parametro?.unita;
  if (voce.forma === "fisso") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-[#EDEDED] px-2.5 py-1 text-[15px] font-semibold text-[#0D2537] dark:bg-[#22313D] dark:text-[#E6EEF4]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {valore} {unita}
      </span>
    );
  }
  if (voce.forma === "elenco") {
    return (
      <button
        type="button"
        onClick={onApriElenco}
        disabled={inCorso}
        aria-label={`${voce.nome}: ${etichettaElenco(voce)}${puoCambiare ? ", apri per cambiare" : ""}`}
        className={cn(CAMPO, "border-[#D0D8DC] text-left dark:border-[#3A4A57]", voce.stato.cambiato && "border-2 border-[#0D2537] font-bold dark:border-[#E6EEF4]")}
      >
        {etichettaElenco(voce)} ▾
      </button>
    );
  }
  const salva = () => {
    // Invio e poi l'uscita dal campo salverebbero due volte lo stesso valore: si salva solo ciò che è cambiato.
    if (inCorso || bozza.trim() === valore.trim()) return;
    void onSalva({ valore: bozza });
  };
  return (
    <label className="inline-flex items-center gap-1.5">
      <input
        type={voce.forma === "numero" ? "number" : "text"}
        inputMode={voce.forma === "numero" ? "numeric" : undefined}
        min={voce.parametro?.min}
        max={voce.parametro?.max}
        value={bozza}
        placeholder={voce.forma === "testo" ? "vuoto" : undefined}
        aria-label={voce.nome}
        aria-invalid={errore ? true : undefined}
        disabled={!puoCambiare || inCorso}
        onChange={(e) => setBozza(e.target.value)}
        onBlur={salva}
        onKeyDown={(e) => {
          if (e.key === "Enter") salva();
          if (e.key === "Escape") setBozza(valore);
        }}
        className={cn(
          CAMPO,
          voce.forma === "numero" ? "w-[84px] text-right" : "w-[140px]",
          errore
            ? "border-2 border-[#8E1B20] dark:border-[#E8625A]"
            : voce.stato.cambiato
              ? "border-2 border-[#0D2537] font-bold dark:border-[#E6EEF4]"
              : "border-[#D0D8DC] dark:border-[#3A4A57]",
        )}
      />
      {unita && <span className="text-[14px]">{unita}</span>}
    </label>
  );
}

/** La finestra di un elenco (oggetto 17): caselle se ha le scelte, una voce per riga se no. */
export function DialogoElenco({
  voce,
  puoCambiare,
  onSalva,
  onChiudi,
}: {
  voce: VoceOpzione | null;
  puoCambiare: boolean;
  onSalva: SalvaParametro;
  onChiudi: () => void;
}) {
  const [scelte, setScelte] = useState<string[]>([]);
  const [testo, setTesto] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    if (!voce) return;
    const voci = (voce.stato.valore ?? "").split(",").filter(Boolean);
    setScelte(voci);
    setTesto(voci.join("\n"));
    setErrore(null);
  }, [voce]);

  const invia = async (corpo: { valore?: string; diSerie?: true }) => {
    setInCorso(true);
    const e = await onSalva(corpo);
    setInCorso(false);
    if (e) setErrore(e);
    else onChiudi();
  };

  return (
    <Dialog open={voce !== null} onOpenChange={(aperto) => { if (!aperto) onChiudi(); }}>
      <DialogContent className="sm:max-w-xl">
        {voce && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">{voce.nome}</DialogTitle>
              <DialogDescription className="text-[15px] font-light">{voce.cosa}</DialogDescription>
            </DialogHeader>
            {voce.scelte ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[15px]">
                {voce.scelte.map((s) => (
                  <label key={s.valore} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={scelte.includes(s.valore)}
                      disabled={!puoCambiare || inCorso}
                      onChange={(e) =>
                        setScelte((x) => (e.target.checked ? [...x, s.valore] : x.filter((y) => y !== s.valore)))
                      }
                    />
                    {s.etichetta}
                  </label>
                ))}
              </div>
            ) : (
              <label className="flex flex-col gap-1.5 text-[14px]">
                Una porta o un intervallo (8000-8100) per riga
                <textarea
                  rows={10}
                  value={testo}
                  disabled={!puoCambiare || inCorso}
                  onChange={(e) => setTesto(e.target.value)}
                  className="rounded-lg border border-[#D0D8DC] bg-white px-2 py-1.5 font-mono text-[14px] dark:border-[#3A4A57] dark:bg-transparent"
                />
              </label>
            )}
            <p className="text-[14px] font-light">Di serie: {voce.diSerie}. Vale per tutti i clienti · si registra chi l&apos;ha cambiato e quando.</p>
            {errore && (
              <p role="alert" className="flex items-center gap-2 text-[14px]">
                <span className="rounded-md bg-[#8E1B20] px-2 py-0.5 text-[13px] font-semibold text-white dark:bg-[#E8625A] dark:text-[#0D2537]">✕ non salvato</span>
                {errore}
              </p>
            )}
            <DialogFooter className="gap-2">
              {puoCambiare && voce.stato.cambiato && (
                <Button variant="outline" className="mr-auto min-h-11 text-[15px]" disabled={inCorso} onClick={() => void invia({ diSerie: true })}>
                  {voce.scelte ? "Torna alle categorie di serie" : "Torna all'elenco di serie"}
                </Button>
              )}
              <Button variant="outline" className="min-h-11 text-[15px]" onClick={onChiudi}>{puoCambiare ? "Annulla" : "Chiudi"}</Button>
              {puoCambiare && (
                <Button
                  className="min-h-11 bg-[#0D2537] text-[15px] font-semibold text-white hover:bg-[#0D2537]/90 dark:bg-[#E6EEF4] dark:text-[#0D2537]"
                  disabled={inCorso}
                  onClick={() => void invia({ valore: voce.scelte ? scelte.join(",") : testo })}
                >
                  Salva
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
