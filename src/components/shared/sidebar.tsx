"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "next-auth/react";
import { TenantSwitcher } from "./tenant-switcher";
import {
  LayoutDashboard,
  Network,
  Scan,
  Router,
  Cable,
  Key,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Server,
  Shield,
  ListOrdered,
  Package,
  User,
  FileKey,
  FolderTree,
  Building2,
  ClipboardList,
  Radar,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const inventorySubItems = [
  { href: "/inventory", label: "Asset", icon: Package },
  { href: "/inventory/assignees", label: "Assegnatari", icon: User },
  { href: "/inventory/licenses", label: "Licenze", icon: FileKey },
] as const;

const networkSubItems = [
  { href: "/networks", label: "Subnet", icon: Network },
  { href: "/discovery", label: "Inventario", icon: Radar },
  { href: "/devices/router", label: "Router", icon: Router },
  { href: "/devices/switch", label: "Switch", icon: Cable },
  { href: "/devices/firewall", label: "Firewall", icon: Shield },
  { href: "/arp-table", label: "Tabella ARP", icon: ListOrdered },
  { href: "/dhcp", label: "Tabella DHCP", icon: Server },
  { href: "/credentials", label: "Credenziali", icon: Key },
  { href: "/scans", label: "Scansioni", icon: Scan },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const isSuperadmin = userRole === "superadmin";
  const tenantCode = (session?.user as { tenantCode?: string } | undefined)?.tenantCode;
  const tenants = ((session?.user as Record<string, unknown>)?.tenants ?? []) as Array<{ code: string; name: string }>;
  const currentTenantName = tenantCode === "__ALL__"
    ? "Tutti i clienti"
    : tenants.find((t) => t.code === tenantCode)?.name ?? tenantCode ?? "";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(() =>
    networkSubItems.some((d) => pathname.startsWith(d.href))
  );
  const [inventoryOpen, setInventoryOpen] = useState(() =>
    inventorySubItems.some((d) => pathname.startsWith(d.href))
  );

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const nav = (
    <>
      {/* Header: Logo */}
      <div className="shrink-0 p-4 border-b border-sidebar-border text-center">
        <div className="w-full flex justify-center">
          <img
            src="/logo-white.png"
            alt="Logo"
            className="w-full max-w-[220px] h-14 object-contain object-center"
          />
        </div>
        <h1 className="text-xl font-bold text-primary mt-3">DA-INVENT</h1>
        <p className="text-xs text-sidebar-foreground/60 mt-0.5">IP Address Management</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">

        {/* ═══ GESTIONE CLIENTI (solo superadmin) ═══ */}
        {isSuperadmin && (
          <>
            <Link
              href="/tenants"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive("/tenants")
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Building2 className="h-4 w-4" />
              Clienti
            </Link>
          </>
        )}

        {/* ═══ TENANT SWITCHER + SEPARATORE ═══ */}
        <div className="pt-2 pb-1">
          <TenantSwitcher />
          {currentTenantName && (
            <div className="mt-2 px-3">
              <div className="border-t border-sidebar-border pt-2">
                <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
                  Dati cliente
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ═══ VOCI DIPENDENTI DAL TENANT ═══ */}

        {/* Dashboard */}
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/"
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Link>

        {/* Network collapsible */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setNetworkOpen((o) => !o)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full",
              networkSubItems.some((d) => pathname.startsWith(d.href))
                ? "bg-sidebar-primary/20 text-sidebar-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            {networkOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Network className="h-4 w-4" />
            Network
          </button>
          {networkOpen && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2">
              {networkSubItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                    isActive(item.href)
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Dispositivi */}
        <Link
          href="/devices"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            pathname === "/devices" || (pathname.startsWith("/devices/") && !networkSubItems.some((n) => pathname.startsWith(n.href)))
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Cable className="h-4 w-4" />
          Dispositivi
        </Link>

        {/* Inventario collapsible */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setInventoryOpen((o) => !o)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full",
              inventorySubItems.some((d) => pathname.startsWith(d.href))
                ? "bg-sidebar-primary/20 text-sidebar-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            {inventoryOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Package className="h-4 w-4" />
            Inventario
          </button>
          {inventoryOpen && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2">
              {inventorySubItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                    isActive(item.href)
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Active Directory */}
        <Link
          href="/active-directory"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            isActive("/active-directory")
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <FolderTree className="h-4 w-4" />
          Active Directory
        </Link>

        {/* Config Cliente — disabilitato, da rifare con UX guidata */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/40 cursor-not-allowed"
          title="In arrivo"
        >
          <ClipboardList className="h-4 w-4" />
          Config Cliente
        </div>

        {/* ═══ SEPARATORE SISTEMA ═══ */}
        <div className="pt-3 px-3">
          <div className="border-t border-sidebar-border pt-2">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
              Sistema
            </p>
          </div>
        </div>

        {/* Impostazioni (globale) */}
        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            isActive("/settings")
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Settings className="h-4 w-4" />
          Impostazioni
        </Link>

      </nav>

      {/* Footer: Logout */}
      <div className="shrink-0 p-3 border-t border-sidebar-border">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          Esci
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-3 left-3 z-50 md:hidden bg-sidebar text-sidebar-foreground"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col z-40 transition-transform duration-200",
          "md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
