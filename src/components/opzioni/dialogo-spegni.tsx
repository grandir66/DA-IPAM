"use client";

/**
 * Il dialogo prima di spegnere (oggetto 10 della tavola): cosa si ferma, cosa resta, e che dopo gli aggiornamenti resta
 * spenta. Per un modulo dice «disinstallare». Con `accendi` è la conferma prima di accendere un'opzione che ha
 * `accendendo` (la pulizia degli host, che cancella righe).
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { VoceOpzione } from "@/lib/opzioni/tipi";

export function DialogoSpegni({
  voce,
  cliente,
  accendi = false,
  onConferma,
  onAnnulla,
}: {
  voce: VoceOpzione | null;
  accendi?: boolean;
  cliente: string;
  onConferma: () => void;
  onAnnulla: () => void;
}) {
  const modulo = voce?.forma === "modulo";
  return (
    <Dialog open={voce !== null} onOpenChange={(aperto) => { if (!aperto) onAnnulla(); }}>
      <DialogContent className="sm:max-w-xl">
        {voce && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">
                {accendi ? "Accendere" : modulo ? "Disinstallare" : "Spegnere"} «{voce.nome}»?
              </DialogTitle>
              <DialogDescription className="sr-only">{accendi ? "Che cosa farà" : "Cosa si ferma e cosa resta"}</DialogDescription>
            </DialogHeader>
            {accendi ? (
              <p className="text-[15px] font-light leading-relaxed">{voce.accendendo}</p>
            ) : (
              <div className="space-y-1.5 text-[15px] font-light leading-relaxed">
                <p><b className="font-semibold">Si ferma:</b> {voce.spegnendo?.siFerma ?? `«${voce.nome}».`}</p>
                <p><b className="font-semibold">Resta:</b> {voce.spegnendo?.resta ?? "tutto quello già letto."}</p>
                <p><b className="font-semibold">Dopo gli aggiornamenti:</b> {modulo ? "resta disinstallato." : "resta spenta. Non si riaccende da sola."}</p>
              </div>
            )}
            <p className="text-[14px] text-muted-foreground">
              {voce.valePer === "hub" ? "Vale per tutti i clienti" : `Cliente ${cliente}`} · si registra chi l&apos;ha {accendi ? "accesa" : modulo ? "disinstallato" : "spenta"} e quando.
            </p>
            <DialogFooter>
              <Button variant="outline" className="min-h-11 text-[15px]" onClick={onAnnulla}>Annulla</Button>
              <Button className="min-h-11 bg-[#0D2537] text-[15px] font-semibold text-white hover:bg-[#0D2537]/90 dark:bg-[#E6EEF4] dark:text-[#0D2537]" onClick={onConferma}>
                {accendi ? "Accendi" : modulo ? "Disinstalla" : "Spegni"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
