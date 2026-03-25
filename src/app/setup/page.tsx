"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Building2 } from "lucide-react";

interface TenantOption {
  id: number;
  codice_cliente: string;
  ragione_sociale: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<"superadmin" | "admin">("superadmin");
  const [tenantId, setTenantId] = useState<string>("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [isMultiTenant, setIsMultiTenant] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then(r => r.json())
      .then(data => {
        if (!data.needsSetup) {
          router.push("/login");
          return;
        }
        const t = data.tenants ?? [];
        setTenants(t);
        // Multi-tenant: mostra selettore ruolo solo se ci sono 2+ tenant
        setIsMultiTenant(t.length > 1);
      })
      .catch(() => {});
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

    if (isMultiTenant && role === "admin" && !tenantId) {
      setError("Seleziona un cliente per il ruolo Amministratore");
      setLoading(false);
      return;
    }

    try {
      const body: Record<string, unknown> = { username, password };
      if (isMultiTenant) {
        body.role = role;
        if (role === "admin") body.tenant_id = Number(tenantId);
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

  const description = isMultiTenant
    ? role === "superadmin"
      ? "Configurazione iniziale — Super Amministratore con accesso a tutti i clienti"
      : "Configurazione iniziale — Amministratore di un singolo cliente"
    : "Configurazione iniziale — Crea l'account amministratore";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo-color.png" alt="Logo" className="h-14 w-64 object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">DA-INVENT</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Selettore ruolo: visibile solo in modalità multi-tenant */}
            {isMultiTenant && (
              <div className="space-y-2">
                <Label>Tipo di account</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setRole("superadmin"); setTenantId(""); }}
                    className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm transition-colors ${
                      role === "superadmin"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted hover:border-muted-foreground/30"
                    }`}
                  >
                    <Shield className="h-6 w-6" />
                    <span className="font-medium">Super Amministratore</span>
                    <span className="text-xs text-muted-foreground text-center">Gestisce tutti i clienti</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("admin")}
                    className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm transition-colors ${
                      role === "admin"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted hover:border-muted-foreground/30"
                    }`}
                  >
                    <Building2 className="h-6 w-6" />
                    <span className="font-medium">Amministratore</span>
                    <span className="text-xs text-muted-foreground text-center">Gestisce un singolo cliente</span>
                  </button>
                </div>
              </div>
            )}

            {/* Dropdown tenant: visibile solo se admin + multi-tenant */}
            {isMultiTenant && role === "admin" && (
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={tenantId} onValueChange={(v) => setTenantId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map(t => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.ragione_sociale || t.codice_cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
              {loading ? "Configurazione in corso..." : "Crea Account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
