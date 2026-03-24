"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, AlertCircle } from "lucide-react";

interface TenantInfo {
  code: string;
  name: string;
  role: string;
}

export default function SelectTenantPage() {
  const { data: session, update, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const tenants = ((session?.user as Record<string, unknown>)?.tenants ?? []) as TenantInfo[];
  const role = (session?.user as Record<string, unknown>)?.role as string | undefined;

  // Se un solo tenant, redirect automatico
  useEffect(() => {
    if (status !== "authenticated") return;
    if (tenants.length === 1) {
      const code = tenants[0].code;
      update({ tenantCode: code }).then(() => {
        router.push("/");
      });
    }
  }, [status, tenants, update, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  async function handleSelect(code: string) {
    setLoading(code);
    try {
      // Verifica accesso lato server
      const res = await fetch("/api/auth/select-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantCode: code }),
      });
      if (!res.ok) {
        setLoading(null);
        return;
      }
      // Aggiorna il JWT client-side
      await update({ tenantCode: code });
      router.push("/");
    } catch {
      setLoading(null);
    }
  }

  // Nessun tenant assegnato
  if (tenants.length === 0 && role !== "superadmin" && role !== "admin") {
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
            <CardTitle className="text-xl font-bold text-primary">DA-INVENT</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">
              Nessun cliente assegnato. Contatta l&apos;amministratore.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Auto-redirect in corso per singolo tenant
  if (tenants.length === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Caricamento...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4 rounded-md bg-[#0D2537] px-6 py-4 mx-auto w-fit">
            <img
              src="/logo-white.png"
              alt="DA-INVENT"
              className="h-12 w-auto max-w-[260px] object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-primary">Seleziona Cliente</h1>
          <p className="text-muted-foreground">Scegli il cliente su cui lavorare</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {tenants.map((tenant) => (
            <Card
              key={tenant.code}
              className={`cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 hover:shadow-md ${
                loading === tenant.code ? "opacity-70 pointer-events-none" : ""
              }`}
              onClick={() => handleSelect(tenant.code)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{tenant.name}</p>
                  <p className="text-xs text-muted-foreground">{tenant.code}</p>
                </div>
                <Badge variant="secondary">{tenant.role}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
