"use client";

import { useCallback, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Conferma di chi sta agendo sulle operazioni che creano potere (15/11/2026): creare o promuovere un
 * amministratore, reimpostare una password, azzerare o togliere la verifica in due passaggi. Il server risponde
 * 403 con `serveConferma` («codice» per chi ha la verifica attiva, «password» per gli altri): qui si apre il
 * dialogo, e la stessa richiesta riparte col valore dentro. Stesso aspetto del dialogo di «Backup database…».
 */
type Cosa = "codice" | "password";

export function useConfermaIdentita() {
  const [cosa, setCosa] = useState<Cosa | null>(null);
  const [valore, setValore] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const risolvi = useRef<((v: string | null) => void) | null>(null);

  const chiedi = useCallback((c: Cosa, messaggio: string | null) => {
    setCosa(c);
    setValore("");
    setErrore(messaggio);
    return new Promise<string | null>((resolve) => { risolvi.current = resolve; });
  }, []);

  const chiudi = useCallback((v: string | null) => {
    setCosa(null);
    setValore("");
    risolvi.current?.(v);
    risolvi.current = null;
  }, []);

  /** Come `fetch` con un corpo JSON; se il server chiede la conferma apre il dialogo e riprova (al più tre volte). */
  const fetchConfermato = useCallback(
    async (url: string, metodo: "POST" | "PUT", corpo: Record<string, unknown>): Promise<Response> => {
      let invio = corpo;
      let messaggio: string | null = null;
      for (let giro = 0; ; giro++) {
        const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(invio) });
        if (res.status !== 403 || giro >= 3) return res;
        const dati = (await res.clone().json().catch(() => null)) as { serveConferma?: Cosa; error?: string } | null;
        if (dati?.serveConferma !== "codice" && dati?.serveConferma !== "password") return res;
        // Al primo giro il 403 è solo la richiesta; dal secondo dice che il valore dato era sbagliato.
        if (giro > 0) messaggio = dati.error ?? "Conferma non valida";
        const dato = await chiedi(dati.serveConferma, messaggio);
        if (dato === null) return res;
        invio = { ...corpo, [dati.serveConferma === "codice" ? "conferma_codice" : "conferma_password"]: dato };
      }
    },
    [chiedi],
  );

  const pronto = cosa === "codice" ? valore.length === 6 : valore.length > 0;
  const dialogo = (
    <Dialog open={cosa !== null} onOpenChange={(open) => { if (!open) chiudi(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conferma che sei tu</DialogTitle>
          <DialogDescription>
            Questa operazione dà o toglie l&apos;accesso da amministratore: serve una conferma.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pronto) chiudi(valore);
          }}
        >
          {cosa === "codice" ? (
            <>
              <Label htmlFor="conferma-identita">Codice della verifica in due passaggi</Label>
              <Input
                id="conferma-identita"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="w-40 font-mono"
                value={valore}
                onChange={(e) => { setValore(e.target.value.replace(/\D/g, "")); setErrore(null); }}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">La conferma vale 5 minuti.</p>
            </>
          ) : (
            <>
              <Label htmlFor="conferma-identita">La tua password</Label>
              <Input
                id="conferma-identita"
                type="password"
                autoComplete="current-password"
                className="w-64"
                value={valore}
                onChange={(e) => { setValore(e.target.value); setErrore(null); }}
                autoFocus
              />
            </>
          )}
          {errore && (
            <p className="flex items-start gap-2 rounded-md border-2 border-foreground/40 p-2 text-sm font-medium">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {errore}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => chiudi(null)}>Annulla</Button>
            <Button type="submit" disabled={!pronto}>Conferma</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { fetchConfermato, dialogo };
}
