"use client";

import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { urlAccessoDomarc } from "@/lib/daauth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  // Secondi residui del backoff di login (0 = non bloccato). Mostrato come countdown
  // così l'utente sa di dover aspettare, non di aver perso la password.
  const [lockSec, setLockSec] = useState(0);
  // Sta provando a entrare con l'account Domarc (o è appena tornato da
  // auth.domarc.it): la pagina lo dice, invece di restare ferma un secondo.
  const [domarcInCorso, setDomarcInCorso] = useState(false);
  const [domarcErrore, setDomarcErrore] = useState("");
  // Indirizzo del servizio di autenticazione Domarc, letto da /api/setup.
  // Vuoto = questa installazione non lo usa: è il caso delle appliance dei
  // clienti, dove il bottone non deve nemmeno comparire.
  const [daauthUrl, setDaauthUrl] = useState("");

  /**
   * Accesso con l'account Domarc.
   *
   * Due tempi, e sono l'uno la conseguenza dell'altro: prima si prova con il
   * cookie che il browser ha già (chi è entrato in un'altra applicazione
   * Domarc non deve rifare niente); se non c'è, si va su auth.domarc.it e si
   * torna qui con `?domarc=1`, che fa ripartire il primo tempo.
   */
  const entraConDomarc = useCallback(async (mandaAllAccesso: boolean, base: string) => {
    if (!base) return;
    setDomarcErrore("");
    setDomarcInCorso(true);
    try {
      const esito = await signIn("domarc", { redirect: false });
      if (esito?.ok && !esito?.error) {
        window.location.assign("/");
        return;
      }
      if (mandaAllAccesso) {
        window.location.assign(
          urlAccessoDomarc(base, `${window.location.origin}/login?domarc=1`),
        );
        return;
      }
      // Tornati dall'accesso e ancora non riconosciuti: l'utenza Domarc esiste
      // ma qui no. Dirlo, invece di rimandare in un giro che rifarebbe lo
      // stesso percorso all'infinito.
      setDomarcErrore(
        "Il tuo account Domarc è valido, ma non risulta un'utenza DA-INVENT. Chiedi a un amministratore.",
      );
    } catch {
      setDomarcErrore("Servizio di autenticazione non raggiungibile. Usa username e password.");
    } finally {
      setDomarcInCorso(false);
    }
  }, []);

  // Ritorno da auth.domarc.it: si riprova una volta sola, senza rimbalzare.
  // Parte solo quando si sa che l'opzione è accesa, cioè dopo /api/setup.
  useEffect(() => {
    if (!daauthUrl || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("domarc") !== "1") return;
    // Differito, non chiamato qui dentro: `entraConDomarc` imposta stato
    // appena parte, e farlo in modo sincrono in un effetto innesca un giro di
    // render in più (il lint di DA-Vul-can lo segnala; qui la regola non c'è,
    // ma il codice è lo stesso e non deve divergere).
    const id = setTimeout(() => void entraConDomarc(false, daauthUrl), 0);
    return () => clearTimeout(id);
  }, [entraConDomarc, daauthUrl]);

  useEffect(() => {
    if (lockSec <= 0) return;
    const id = setTimeout(() => setLockSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [lockSec]);

  useEffect(() => {
    // Non lasciare mai “Caricamento…” all’infinito (DB bloccato, /api/setup lento, rete locale).
    const giveUp = setTimeout(() => setChecking(false), 12_000);
    const ac = new AbortController();
    const abortSlow = setTimeout(() => ac.abort(), 10_000);
    fetch("/api/setup", { signal: ac.signal, credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { needsSetup?: boolean; daauthUrl?: string }) => {
        setDaauthUrl((data.daauthUrl || "").trim());
        if (data.needsSetup) {
          router.replace("/setup");
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false))
      .finally(() => {
        clearTimeout(abortSlow);
        clearTimeout(giveUp);
      });
    return () => {
      clearTimeout(giveUp);
      clearTimeout(abortSlow);
      ac.abort();
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await signIn("credentials", {
        username: formData.get("username"),
        password: formData.get("password"),
        redirect: false,
      });

      if (result?.error) {
        // Distinguere un blocco temporaneo (backoff) da credenziali errate:
        // interroga lo stato del lock e mostra il countdown, invece di far credere
        // all'utente di aver perso la password.
        try {
          const u = String(formData.get("username") || "");
          const r = await fetch(`/api/auth/lock-state?u=${encodeURIComponent(u)}`, {
            credentials: "same-origin",
          });
          const data = (await r.json().catch(() => null)) as
            | { locked?: boolean; retryAfterSec?: number }
            | null;
          if (data?.locked && (data.retryAfterSec ?? 0) > 0) {
            setLockSec(data.retryAfterSec as number);
            setError("");
            return;
          }
        } catch {
          /* endpoint non raggiungibile → messaggio generico sotto */
        }
        setError("Credenziali non valide");
        return;
      }
      if (result?.ok === false && !result?.error) {
        setError("Accesso non riuscito");
        return;
      }
      // Navigazione completa: assicura che i cookie di sessione siano inviati al middleware (evita loop login)
      window.location.assign("/");
    } catch {
      setError("Errore di connessione durante l’accesso");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4 rounded-md bg-[#0D2537] px-6 py-4">
            <img
              src="/logo-white.png"
              alt="DA-INVENT"
              className="h-12 w-auto max-w-[260px] object-contain"
            />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">DA-INVENT</CardTitle>
          <CardDescription>Accedi al sistema di gestione IP</CardDescription>
        </CardHeader>
        <CardContent>
          {daauthUrl && (
            <>
              <Button
                type="button"
                className="w-full"
                disabled={domarcInCorso}
                onClick={() => void entraConDomarc(true, daauthUrl)}
              >
                {domarcInCorso ? "Accesso in corso..." : "Accedi con l'account Domarc"}
              </Button>
              {domarcErrore && <p className="mt-2 text-sm text-destructive">{domarcErrore}</p>}
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                oppure con username e password
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" required placeholder="admin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {lockSec > 0 ? (
              <p className="text-sm text-destructive">
                Troppi tentativi falliti. Riprova tra {Math.floor(lockSec / 60)}:
                {String(lockSec % 60).padStart(2, "0")}.
              </p>
            ) : (
              error && <p className="text-sm text-destructive">{error}</p>
            )}
            <Button
              type="submit"
              variant={daauthUrl ? "outline" : "default"}
              className="w-full"
              disabled={loading || lockSec > 0}
            >
              {loading ? "Accesso in corso..." : "Accedi"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
