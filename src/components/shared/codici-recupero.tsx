"use client";

import { useEffect, useState } from "react";
import { Copy, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";

/** Lo stato dei codici dell'utente collegato: null finché non è letto. Si rilegge quando cambia `segno`. */
export function useCodiciRecupero(segno: number): { attiva: boolean; rimasti: number } | null {
  const [stato, setStato] = useState<{ attiva: boolean; rimasti: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    void fetchJson<{ attiva: boolean; rimasti: number }>("/api/auth/codici-recupero").then((r) => {
      if (vivo && r.ok) setStato(r.data);
    });
    return () => { vivo = false; };
  }, [segno]);
  return stato;
}

/**
 * «Codici di recupero…» (piano di sicurezza 14/11, P0-2; tavola approvata da Riccardo, oggetti 2 e 3): chiede il
 * codice dell'app, poi mostra gli otto codici UNA volta sola. Chiusa la finestra restano solo sul foglio.
 */
export function CodiciRecupero({ aperto, onChiudi, utente }: { aperto: boolean; onChiudi: () => void; utente: string }) {
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);
  const [codici, setCodici] = useState<string[] | null>(null);

  function chiudi() {
    setCodice("");
    setErrore(null);
    setAttesa(false);
    setCodici(null);
    onChiudi();
  }

  async function genera() {
    setAttesa(true);
    const r = await fetchJson<{ codici: string[] }>("/api/auth/codici-recupero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice }),
    });
    setCodice("");
    setAttesa(false);
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setCodici(r.data.codici);
  }

  function stampa() {
    if (!codici) return;
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) {
      toast.error("Il browser ha bloccato la finestra di stampa: usa «Copia»");
      return;
    }
    const d = w.document;
    d.title = "Codici di recupero";
    const h = d.createElement("h1");
    h.textContent = `Codici di recupero di ${utente}`;
    h.style.cssText = "font: 600 18px sans-serif";
    const p = d.createElement("p");
    p.textContent = `Generati il ${new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}. Ognuno vale una volta, al posto del codice dell'app.`;
    p.style.cssText = "font: 13px sans-serif";
    d.body.append(h, p);
    for (const c of codici) {
      const r = d.createElement("div");
      r.textContent = c;
      r.style.cssText = "font: 18px monospace; margin: 8px 0";
      d.body.append(r);
    }
    w.print();
  }

  async function copia() {
    if (!codici) return;
    try {
      await navigator.clipboard.writeText(codici.join("\n"));
      toast.success("Codici copiati");
    } catch {
      toast.error("Copia non riuscita: usa «Stampa» o scrivili a mano");
    }
  }

  return (
    <Dialog open={aperto} onOpenChange={(open) => { if (!open) chiudi(); }}>
      <DialogContent>
        {codici ? (
          <>
            <DialogHeader>
              <DialogTitle>Stampa questi codici</DialogTitle>
              <DialogDescription>Ognuno vale una volta, al posto del codice dell&apos;app, se perdi il telefono.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {codici.map((c) => (
                <div key={c} className="rounded-md border px-2 py-1.5 text-center font-mono text-sm">{c}</div>
              ))}
            </div>
            <p className="flex items-start gap-2 rounded-md border-2 border-foreground/40 p-2 text-sm font-medium">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Non li rivedrai: chiusa questa finestra restano solo sul foglio.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={stampa}><Printer className="mr-2 h-4 w-4" />Stampa</Button>
              <Button type="button" variant="outline" onClick={() => void copia()}><Copy className="mr-2 h-4 w-4" />Copia</Button>
              <Button type="button" onClick={chiudi}>Li ho salvati</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Codici di recupero</DialogTitle>
              <DialogDescription>Servono se perdi il telefono. Generarne di nuovi annulla quelli di prima.</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void genera(); }}>
              <Label htmlFor="codice-2fa-recupero">Codice a 6 cifre dell&apos;app</Label>
              <Input
                id="codice-2fa-recupero"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="w-40 font-mono"
                value={codice}
                onChange={(e) => { setCodice(e.target.value.replace(/\D/g, "")); setErrore(null); }}
                autoFocus
              />
              {errore && (
                <p className="flex items-start gap-2 rounded-md border-2 border-foreground/40 p-2 text-sm font-medium">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {errore}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={chiudi}>Annulla</Button>
                <Button type="submit" disabled={codice.length !== 6 || attesa}>Genera 8 codici</Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
