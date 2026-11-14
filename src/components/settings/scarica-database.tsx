"use client";

import { useState } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";

/**
 * «Backup database…» (piano di sicurezza 14/11, P0-1): lo scarico di `hub.db` chiede il codice della verifica in
 * due passaggi, con la stessa conferma di «Mostra password» (5 minuti). Senza verifica attiva non parte
 * (Riccardo, 14/11: «si blocca») e il dialogo dice perché.
 */
export function ScaricaDatabase() {
  const [aperto, setAperto] = useState(false);
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  function chiudi() {
    setAperto(false);
    setCodice("");
    setErrore(null);
    setAttesa(false);
  }

  function scarica() {
    window.location.href = "/api/backup";
    chiudi();
  }

  async function apri() {
    // Una conferma ancora valida (da qui o da «Mostra password») non si richiede due volte.
    const r = await fetchJson<{ scade: string | null }>("/api/vault/conferma");
    if (r.ok && r.data.scade) {
      scarica();
      return;
    }
    setAperto(true);
  }

  async function conferma() {
    setAttesa(true);
    const r = await fetchJson<{ scade: string }>("/api/vault/conferma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice, scopo: "backup" }),
    });
    setCodice("");
    setAttesa(false);
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    scarica();
  }

  return (
    <>
      <Button variant="outline" onClick={() => void apri()}>
        <Lock className="h-4 w-4 mr-2" />
        Backup database…
      </Button>
      <Dialog open={aperto} onOpenChange={(open) => { if (!open) chiudi(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scarica il database dell&apos;istanza</DialogTitle>
            <DialogDescription>
              Il file contiene utenti, profili e configurazione, non cifrati. Va tenuto in un posto protetto.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void conferma();
            }}
          >
            <Label htmlFor="codice-2fa-backup">Codice della verifica in due passaggi</Label>
            <Input
              id="codice-2fa-backup"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="w-40 font-mono"
              value={codice}
              onChange={(e) => { setCodice(e.target.value.replace(/\D/g, "")); setErrore(null); }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">La conferma vale 5 minuti.</p>
            {errore && (
              <p className="flex items-start gap-2 rounded-md border-2 border-foreground/40 p-2 text-sm font-medium">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {errore}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={chiudi}>Annulla</Button>
              <Button type="submit" disabled={codice.length !== 6 || attesa}>Scarica</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
