"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

interface TenantInfo {
  code: string;
  name: string;
  role: string;
}

export function TenantSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const tenants = ((session?.user as Record<string, unknown>)?.tenants ?? []) as TenantInfo[];
  const currentCode = (session?.user as Record<string, unknown>)?.tenantCode as string | null;
  const role = (session?.user as Record<string, unknown>)?.role as string | undefined;
  const isSuperadmin = role === "superadmin";
  const currentTenant = currentCode === "__ALL__"
    ? { code: "__ALL__", name: "Tutti i clienti", role: "superadmin" }
    : tenants.find((t) => t.code === currentCode);

  if (tenants.length === 0) {
    return null;
  }

  // Singolo tenant: mostra solo il nome, senza dropdown
  if (tenants.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Building2 className="h-4 w-4 text-sidebar-foreground/60 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium truncate text-sidebar-foreground text-xs">
            {tenants[0].name}
          </p>
          <p className="text-[10px] text-sidebar-foreground/50 truncate">
            {tenants[0].code}
          </p>
        </div>
      </div>
    );
  }

  // Piu' tenant: dropdown per il cambio
  async function handleChange(value: string | null) {
    if (!value || value === currentCode) return;
    await update({ tenantCode: value });
    router.refresh();
  }

  return (
    <div className="px-2 py-2">
      <Select value={currentCode ?? ""} onValueChange={handleChange}>
        <SelectTrigger className="w-full bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground text-xs h-auto py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <SelectValue>
              <div className="min-w-0 text-left">
                <p className="truncate font-medium">{currentTenant?.name ?? "Seleziona..."}</p>
                {currentTenant && (
                  <p className="text-[10px] text-sidebar-foreground/50 truncate">
                    {currentTenant.code}
                  </p>
                )}
              </div>
            </SelectValue>
          </div>
        </SelectTrigger>
        <SelectContent>
          {isSuperadmin && (
            <SelectItem value="__ALL__">Tutti i clienti (aggregata)</SelectItem>
          )}
          {tenants.map((tenant) => (
            <SelectItem key={tenant.code} value={tenant.code}>
              <div className="min-w-0">
                <p className="truncate">{tenant.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{tenant.code}</p>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
