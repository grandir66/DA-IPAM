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
          <div className="flex justify-center mb-4">
            <img src="/logo-color.png" alt="Logo" className="h-14 w-64 object-contain" />
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Accesso in corso..." : "Accedi"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
