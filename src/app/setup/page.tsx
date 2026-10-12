"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Primo avvio: crea il cliente di questa installazione e il suo amministratore.
 *
 * Un'installazione = un cliente (decisione del 2026-10-12, UI-17): la pagina non
 * offre altre modalità. L'API conserva la vecchia modalità senza cliente solo
 * per l'installer di Deploy-Appliance (vedi `src/app/api/setup/route.ts`).
 */
export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkDone, setCheckDone] = useState(false);

  // Dati del cliente
  const [codiceCliente, setCodiceCliente] = useState("");
  const [ragioneSociale, setRagioneSociale] = useState("");

  useEffect(() => {
    fetch("/api/setup")
      .then(r => r.json())
      .then(data => {
        if (!data.needsSetup) {
          router.push("/login");
          return;
        }
        setCheckDone(true);
      })
      .catch(() => setCheckDone(true));
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirm_password") as string;

    if (password !== confirmPassword) {
      setError("Le password non corrispondono");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("La password deve essere di almeno 8 caratteri");
      setLoading(false);
      return;
    }

    if (!codiceCliente.trim()) {
      setError("Il codice cliente è obbligatorio");
      setLoading(false);
      return;
    }
    if (!ragioneSociale.trim()) {
      setError("La ragione sociale è obbligatoria");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          mode: "single",
          codice_cliente: codiceCliente.trim().toUpperCase(),
          ragione_sociale: ragioneSociale.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Errore durante la configurazione");
        setLoading(false);
        return;
      }

      router.push("/login");
    } catch {
      setError("Errore di connessione");
      setLoading(false);
    }
  }

  if (!checkDone) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo-color.png" alt="Logo" className="h-14 w-64 object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">DA-INVENT</CardTitle>
          <CardDescription>
            Installazione per un cliente: crea il database del cliente e l&apos;account amministratore
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Dati del cliente */}
            <div className="space-y-2">
              <Label htmlFor="codice_cliente">Codice Cliente</Label>
              <Input
                id="codice_cliente"
                value={codiceCliente}
                onChange={(e) => setCodiceCliente(e.target.value)}
                required
                placeholder="es. ACME-001"
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ragione_sociale">Ragione Sociale</Label>
              <Input
                id="ragione_sociale"
                value={ragioneSociale}
                onChange={(e) => setRagioneSociale(e.target.value)}
                required
                placeholder="es. ACME S.r.l."
              />
            </div>

            {/* Credenziali */}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" required minLength={3} placeholder="admin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_password">Conferma Password</Label>
              <Input id="confirm_password" name="confirm_password" type="password" required />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Configurazione in corso..." : "Configura"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
