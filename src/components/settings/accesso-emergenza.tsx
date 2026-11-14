"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleDashed, Copy, LifeBuoy, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import { useEAdmin } from "@/hooks/use-e-admin";

type Stato = { stato: "assente" | "pronto" | "usato"; usatoIl: string | null };

/** Chi cambia lo stato lo dice a chi lo mostra altrove (l'avviso in testa alle pagine). */
const EVENTO = "accesso-emergenza-cambiato";

/** `last_login` è scritto da SQLite in UTC, senza fuso: a schermo in ora italiana. */
export function quandoUsato(usatoIl: string | null): string {
  if (!usatoIl) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(usatoIl) ? usatoIl : `${usatoIl.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? usatoIl : d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function useStatoEmergenza(attivo: boolean): { stato: Stato | null; errore: string | null; rileggi: () => void } {
  const [stato, setStato] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [segno, setSegno] = useState(0);
  const rileggi = useCallback(() => setSegno((n) => n + 1), []);
  useEffect(() => {
    if (!attivo) return;
    let vivo = true;
    void fetchJson<Stato>("/api/auth/emergenza").then((r) => {
      if (!vivo) return;
      if (r.ok) { setStato(r.data); setErrore(null); } else setErrore(r.message);
    });
    return () => { vivo = false; };
  }, [attivo, segno]);
  useEffect(() => {
    window.addEventListener(EVENTO, rileggi);
    return () => window.removeEventListener(EVENTO, rileggi);
  }, [rileggi]);
  return { stato, errore, rileggi };
}

/**
 * Avviso in testa a ogni pagina, solo agli amministratori e solo dopo un uso dell'accesso d'emergenza (piano di
 * sicurezza 14/11, P0-2 tappa D, oggetto 4 della tavola). Sparisce quando un amministratore lo prende in carico:
 * rigenera la frase o toglie l'accesso.
 */
export function AvvisoEmergenzaUsata() {
  const { stato } = useStatoEmergenza(useEAdmin());
  if (stato?.stato !== "usato") return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-md border-2 border-foreground/50 px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1 font-medium">
        L&apos;accesso d&apos;emergenza è stato usato il {quandoUsato(stato.usatoIl)}. Se non sei stato tu, cambia le
        password degli amministratori.
      </p>
      <Link href="/settings?tab=utenti" className="shrink-0 font-medium underline underline-offset-2">
        Prendi in carico ›
      </Link>
    </div>
  );
}

/**
 * Riquadro «Accesso d'emergenza» in Impostazioni › Utenti (oggetti 1-3 della tavola): stato, e i due dialoghi per
 * prepararlo. La frase si vede UNA volta; chi la prepara conferma col codice dell'app (5 minuti, come il backup).
 */
export function AccessoEmergenza({ onCambio }: { onCambio?: () => void }) {
  const { stato, errore: erroreStato, rileggi } = useStatoEmergenza(true);
  const [aperto, setAperto] = useState(false);
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);
  const [frase, setFrase] = useState<string | null>(null);

  function cambiato() {
    rileggi();
    window.dispatchEvent(new Event(EVENTO));
    onCambio?.();
  }

  function chiudi() {
    setAperto(false);
    setCodice("");
    setErrore(null);
    setAttesa(false);
    setFrase(null);
  }

  async function crea(): Promise<void> {
    const r = await fetchJson<{ frase: string }>("/api/auth/emergenza", { method: "POST" });
    setAttesa(false);
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setFrase(r.data.frase);
    cambiato();
  }

  async function apri() {
    setAperto(true);
    // Una conferma ancora valida (backup, «Mostra password») non si richiede due volte.
    const r = await fetchJson<{ scade: string | null }>("/api/vault/conferma");
    if (r.ok && r.data.scade) {
      setAttesa(true);
      await crea();
    }
  }

  async function conferma() {
    setAttesa(true);
    const r = await fetchJson<{ scade: string }>("/api/vault/conferma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice, scopo: "backup" }),
    });
    setCodice("");
    if (!r.ok) {
      setAttesa(false);
      setErrore(r.message);
      return;
    }
    await crea();
  }

  async function togli() {
    if (!window.confirm("Togliere l'accesso d'emergenza? La frase in busta non varrà più.")) return;
    const r = await fetchJson<{ tolto: boolean }>("/api/auth/emergenza", { method: "DELETE" });
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success("Accesso d'emergenza tolto");
    cambiato();
  }

  function stampa() {
    if (!frase) return;
    const w = window.open("", "_blank", "width=480,height=480");
    if (!w) {
      toast.error("Il browser ha bloccato la finestra di stampa: usa «Copia»");
      return;
    }
    const d = w.document;
    d.title = "Accesso d'emergenza";
    const h = d.createElement("h1");
    h.textContent = "Accesso d'emergenza";
    h.style.cssText = "font: 600 18px sans-serif";
    const p = d.createElement("p");
    p.textContent = `Preparato il ${new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}. Utente: emergenza. La frase qui sotto è la password: vale una volta sola, per 60 minuti. Da tenere in busta chiusa.`;
    p.style.cssText = "font: 13px sans-serif";
    const f = d.createElement("div");
    f.textContent = frase;
    f.style.cssText = "font: 20px monospace; margin: 16px 0";
    d.body.append(h, p, f);
    w.print();
  }

  async function copia() {
    if (!frase) return;
    try {
      await navigator.clipboard.writeText(frase);
      toast.success("Frase copiata");
    } catch {
      toast.error("Copia non riuscita: usa «Stampa» o scrivila a mano");
    }
  }

  const s = stato?.stato;
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Accesso d&apos;emergenza</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Una frase da tenere in busta chiusa, per entrare se l&apos;amministratore perde password, telefono e codici.
            Vale una volta sola, per 60 minuti, e ogni uso resta nel registro degli accessi.
          </CardDescription>
        </div>
        {s && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant={s === "assente" ? "default" : "outline"} onClick={() => void apri()}>
              {s === "assente" ? "Prepara…" : "Rigenera…"}
            </Button>
            {s !== "assente" && <Button size="sm" variant="outline" onClick={() => void togli()}>Togli</Button>}
          </div>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {erroreStato && !stato && <p className="font-medium">Stato non letto: {erroreStato}</p>}
        {s === "assente" && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <CircleDashed className="h-4 w-4 shrink-0" />
            <span><span className="font-medium text-foreground">Assente.</span> Nessuna frase preparata.</span>
          </p>
        )}
        {s === "pronto" && (
          <p className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 shrink-0" />
            <span><span className="font-medium">Pronto.</span> La frase è in busta; nessuno l&apos;ha usata.</span>
          </p>
        )}
        {s === "usato" && (
          <p className="flex items-start gap-2 rounded-md border-2 border-foreground/50 p-2 font-medium">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Usato il {quandoUsato(stato?.usatoIl ?? null)}. La frase non vale più: rigenerala e metti in busta quella
              nuova, oppure togli l&apos;accesso.
            </span>
          </p>
        )}
      </CardContent>

      <Dialog open={aperto} onOpenChange={(open) => { if (!open) chiudi(); }}>
        <DialogContent>
          {frase ? (
            <>
              <DialogHeader>
                <DialogTitle>Metti questa frase in busta</DialogTitle>
                <DialogDescription>
                  Per entrare: utente <span className="font-mono">emergenza</span>, e questa frase come password.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border px-3 py-3 text-center font-mono text-base tracking-wide select-all">{frase}</div>
              <p className="flex items-start gap-2 rounded-md border-2 border-foreground/40 p-2 text-sm font-medium">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Non la rivedrai: chiusa questa finestra resta solo sul foglio.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={stampa}><Printer className="mr-2 h-4 w-4" />Stampa</Button>
                <Button type="button" variant="outline" onClick={() => void copia()}><Copy className="mr-2 h-4 w-4" />Copia</Button>
                <Button type="button" onClick={chiudi}>L&apos;ho messa in busta</Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{s === "assente" ? "Prepara l'accesso d'emergenza" : "Rigenera l'accesso d'emergenza"}</DialogTitle>
                <DialogDescription>
                  {s === "assente"
                    ? "Chi ha la frase entra come amministratore senza il codice dell'app."
                    : "La frase di prima smette di valere e una sessione d'emergenza aperta si chiude."}
                </DialogDescription>
              </DialogHeader>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void conferma(); }}>
                <Label htmlFor="codice-2fa-emergenza">Codice a 6 cifre dell&apos;app</Label>
                <Input
                  id="codice-2fa-emergenza"
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
                  <Button type="submit" disabled={codice.length !== 6 || attesa}>
                    {s === "assente" ? "Prepara" : "Rigenera"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
