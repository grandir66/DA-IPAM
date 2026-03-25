"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, Building2 } from "lucide-react";

type SetupMode = "single" | "multi";

export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkDone, setCheckDone] = useState(false);
  const [mode, setMode] = useState<SetupMode>("single");

  // Campi single-tenant
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

    if (mode === "single") {
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
    }

    try {
      const body: Record<string, unknown> = {
        username,
        password,
        mode,
      };
      if (mode === "single") {
        body.codice_cliente = codiceCliente.trim().toUpperCase();
        body.ragione_sociale = ragioneSociale.trim();
      }

      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const descriptions: Record<SetupMode, string> = {
    single: "Installazione per un singolo cliente — crea il database e l'account amministratore",
    multi: "Installazione multi-tenant — per MSP e gestione di più clienti",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo-color.png" alt="Logo" className="h-14 w-64 object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">DA-INVENT</CardTitle>
          <CardDescription>{descriptions[mode]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Selettore modalità */}
            <div className="space-y-2">
              <Label>Tipo di installazione</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMode("single")}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm transition-colors ${
                    mode === "single"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <Building2 className="h-6 w-6" />
                  <span className="font-medium">Singolo Cliente</span>
                  <span className="text-xs text-muted-foreground text-center">Un&apos;azienda, un database</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("multi")}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm transition-colors ${
                    mode === "multi"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <Shield className="h-6 w-6" />
                  <span className="font-medium">Multi-Tenant</span>
                  <span className="text-xs text-muted-foreground text-center">MSP / più clienti</span>
                </button>
              </div>
            </div>

            {/* Dati azienda: solo single-tenant */}
            {mode === "single" && (
              <>
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
              </>
            )}

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
