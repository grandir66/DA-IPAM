"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
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
      .then((data: { needsSetup?: boolean }) => {
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
            <Button type="submit" className="w-full" disabled={loading || lockSec > 0}>
              {loading ? "Accesso in corso..." : "Accedi"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
