"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
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
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Voci menu Rete (con router, switch, firewall per gestione infrastruttura) */

const inventorySubItems = [
  { href: "/inventory", label: "Asset", icon: Package },
  { href: "/inventory/assignees", label: "Assegnatari", icon: User },
  { href: "/inventory/licenses", label: "Licenze", icon: FileKey },
] as const;

const networkSubItems = [
  { href: "/networks", label: "Subnet", icon: Network },
  { href: "/devices/router", label: "Router", icon: Router },
  { href: "/devices/switch", label: "Switch", icon: Cable },
  { href: "/devices/firewall", label: "Firewall", icon: Shield },
  { href: "/arp-table", label: "Tabella ARP", icon: ListOrdered },
  { href: "/dhcp", label: "Tabella DHCP", icon: Server },
  { href: "/credentials", label: "Credenziali", icon: Key },
  { href: "/scans", label: "Scansioni", icon: Scan },
] as const;

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/active-directory", label: "Active Directory", icon: FolderTree },
  { href: "/settings", label: "Impostazioni", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
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
        {navItems.slice(1).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              isActive(item.href)
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
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
