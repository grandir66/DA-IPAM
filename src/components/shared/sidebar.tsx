"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "next-auth/react";
import { TenantSwitcher } from "./tenant-switcher";
import { useSidebar } from "./sidebar-context";
import {
  LayoutDashboard,
  Network,
  Scan,
  Key,
  Settings,
  ServerCog,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Server,
  ListOrdered,
  Package,
  User,
  FileKey,
  FolderTree,
  Building2,
  ClipboardList,
  Radar,
  AlertTriangle,
  ShieldAlert,
  Workflow,
  BookOpen,
  Ban,
  ShieldCheck,
  MonitorSmartphone,
  ExternalLink,
  KeyRound,
  Globe,
  Wifi,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

type SubItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Inserisce un separatore visivo PRIMA di questa voce. */
  divider?: string;
};

const inventorySubItems: readonly SubItem[] = [
  { href: "/inventory", label: "Asset", icon: Package },
  { href: "/software", label: "Software", icon: Package },
  { href: "/inventory/assignees", label: "Assegnatari", icon: User },
  { href: "/inventory/locations", label: "Ubicazioni", icon: FolderTree },
  { href: "/inventory/licenses", label: "Licenze", icon: FileKey },
  { href: "/services", label: "Servizi NIS2", icon: Workflow },
] as const;

const networkSubItems: readonly SubItem[] = [
  { href: "/networks", label: "Subnet", icon: Network },
  { href: "/discovery", label: "Discovery", icon: Radar },
  { href: "/vulnerabilities", label: "Vulnerabilità", icon: ShieldAlert },
  { href: "/software", label: "Software", icon: Package },
  { href: "/active-directory", label: "Active Directory", icon: FolderTree },
  { href: "/credentials", label: "Credenziali", icon: Key },
  { href: "/arp-table", label: "Tabella ARP", icon: ListOrdered, divider: "Diagnostica" },
  { href: "/dhcp/sources", label: "Sorgenti DHCP", icon: Server },
  { href: "/scans", label: "Scansioni", icon: Scan },
  { href: "/excluded-ips", label: "IP esclusi", icon: Ban },
] as const;

const networkServicesSubItems: readonly SubItem[] = [
  { href: "/network-services", label: "Panoramica", icon: ServerCog },
  { href: "/dns", label: "DNS", icon: Globe },
  { href: "/dhcp", label: "DHCP", icon: Wifi },
] as const;

const ITEM_BASE =
  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors";
const ITEM_ACTIVE = "bg-sidebar-primary text-sidebar-primary-foreground";
const ITEM_INACTIVE =
  "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/** Voce di menu singola: icona + label. In modalità collassata (desktop) mostra solo l'icona. */
function NavItem({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  onNavigate,
  badgeCount,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const hasBadge = badgeCount != null && badgeCount > 0;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={cn(
        ITEM_BASE,
        "relative",
        active ? ITEM_ACTIVE : ITEM_INACTIVE,
        collapsed && "md:justify-center md:px-0"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn("flex-1", collapsed && "md:hidden")}>{label}</span>
      {hasBadge && (
        <>
          <span
            className={cn(
              "ml-auto inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1",
              collapsed && "md:hidden"
            )}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
          {collapsed && (
            <span className="hidden md:block absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
          )}
        </>
      )}
    </Link>
  );
}

/** Lista di sottovoci (riusata sia inline sia nel flyout). */
function SubList({
  items,
  isActive,
  onNavigate,
}: {
  items: readonly SubItem[];
  isActive: (href: string) => boolean;
  onNavigate: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <div key={item.href}>
          {item.divider && (
            <div className="pt-2 pb-1 px-2.5">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
                {item.divider}
              </p>
            </div>
          )}
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
              isActive(item.href) ? ITEM_ACTIVE : ITEM_INACTIVE
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </Link>
        </div>
      ))}
    </>
  );
}

/**
 * Gruppo collassabile. Espanso: toggle inline con chevron.
 * Collassato (desktop): solo icona + flyout al hover con le sottovoci.
 * Su mobile resta sempre l'espansione inline (collapsed non si applica).
 */
function NavGroup({
  icon: Icon,
  label,
  items,
  open,
  setOpen,
  collapsed,
  isActive,
  onNavigate,
}: {
  icon: LucideIcon;
  label: string;
  items: readonly SubItem[];
  open: boolean;
  setOpen: (fn: (o: boolean) => boolean) => void;
  collapsed: boolean;
  isActive: (href: string) => boolean;
  onNavigate: () => void;
}) {
  const anyActive = items.some((d) => isActive(d.href));
  const btnRef = useRef<HTMLButtonElement>(null);
  // Flyout in position:fixed (sfugge al clip orizzontale di nav overflow-y-auto).
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null);

  const showFlyout = () => {
    if (!collapsed) return;
    const el = btnRef.current;
    if (!el || typeof window === "undefined" || window.innerWidth < 768) return; // solo desktop
    const r = el.getBoundingClientRect();
    setFlyout({ top: r.top, left: r.right });
  };
  const hideFlyout = () => setFlyout(null);

  return (
    <div className="pt-1 relative" onMouseEnter={showFlyout} onMouseLeave={hideFlyout}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? label : undefined}
        className={cn(
          ITEM_BASE,
          "w-full",
          anyActive ? "bg-sidebar-primary/20 text-sidebar-foreground" : ITEM_INACTIVE,
          collapsed && "md:justify-center md:px-0"
        )}
      >
        <span className={cn(collapsed && "md:hidden")}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <Icon className="h-4 w-4 shrink-0" />
        <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>{label}</span>
      </button>

      {/* Espansione inline (mobile sempre; desktop solo se NON collassato) */}
      {open && (
        <div
          className={cn(
            "ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2",
            collapsed && "md:hidden"
          )}
        >
          <SubList items={items} isActive={isActive} onNavigate={onNavigate} />
        </div>
      )}

      {/* Flyout al hover (solo desktop collassato), fixed per non essere clippato */}
      {collapsed && flyout && (
        <div
          style={{ position: "fixed", top: flyout.top, left: flyout.left }}
          className="z-50 pl-2"
        >
          <div className="min-w-[210px] rounded-lg bg-sidebar border border-sidebar-border shadow-xl p-2 space-y-0.5">
            <p className="px-2.5 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
              {label}
            </p>
            <SubList items={items} isActive={isActive} onNavigate={onNavigate} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { collapsed, toggle } = useSidebar();
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
  const [networkServicesOpen, setNetworkServicesOpen] = useState(() =>
    networkServicesSubItems.some((d) => pathname.startsWith(d.href))
  );
  const [unackedAnomalies, setUnackedAnomalies] = useState(0);
  // Moduli abilitati: fonte unica = registry (/api/modules). Ogni voce di menu
  // dei moduli compare SOLO se il modulo è enabled per il tenant.
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [externalModules, setExternalModules] = useState<Array<{ key: string; label: string; url: string }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!tenantCode || tenantCode === "__ALL__") {
      setEnabledModules(new Set());
      setExternalModules([]);
      return;
    }
    fetch("/api/modules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules?: Array<{ key: string; label: string; enabled: boolean; uiUrl: string | null; uiIsInternal: boolean }> } | null) => {
        const mods = d?.modules ?? [];
        setEnabledModules(new Set(mods.filter((m) => m.enabled).map((m) => m.key)));
        setExternalModules(
          mods
            .filter((m) => m.enabled && !m.uiIsInternal && m.uiUrl)
            .map((m) => ({ key: m.key, label: m.label, url: m.uiUrl as string })),
        );
      })
      .catch(() => { /* moduli off come default */ });
  }, [tenantCode]);

  useEffect(() => {
    const fetchUnacked = () => {
      fetch("/api/analytics/anomalies?acknowledged=false&limit=1")
        .then((r) => r.ok ? r.json() : null)
        .then((data: { unacked?: number } | null) => {
          if (data?.unacked != null) setUnackedAnomalies(data.unacked);
        })
        .catch(() => { /* non critico */ });
    };
    fetchUnacked();
    intervalRef.current = setInterval(fetchUnacked, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };
  const closeMobile = () => setMobileOpen(false);

  const nav = (
    <>
      {/* Header: Logo */}
      <div className="shrink-0 p-4 border-b border-sidebar-border text-center">
        <div className={cn("w-full flex justify-center", collapsed && "md:hidden")}>
          <img
            src="/logo-white.png"
            alt="Logo"
            className="w-full max-w-[220px] h-14 object-contain object-center"
          />
        </div>
        {/* Logo compatto (solo desktop collassato) */}
        <img
          src="/logo-white.png"
          alt="Logo"
          className={cn("h-9 mx-auto object-contain", collapsed ? "hidden md:block" : "hidden")}
        />
        <h1 className={cn("text-xl font-bold text-primary mt-3", collapsed && "md:hidden")}>DA-INVENT</h1>
        <p className={cn("text-xs text-sidebar-foreground/60 mt-0.5", collapsed && "md:hidden")}>IP Address Management</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">

        {/* ═══ GESTIONE CLIENTI (solo superadmin) ═══ */}
        {isSuperadmin && (
          <>
            <NavItem href="/tenants" icon={Building2} label="Clienti" active={isActive("/tenants")} collapsed={collapsed} onNavigate={closeMobile} />
            <NavItem href="/agents" icon={ServerCog} label="Agenti remoti" active={isActive("/agents")} collapsed={collapsed} onNavigate={closeMobile} />
          </>
        )}

        {/* ═══ TENANT SWITCHER + SEPARATORE (nascosti se collassato) ═══ */}
        <div className={cn("pt-2 pb-1", collapsed && "md:hidden")}>
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
        <NavItem href="/" icon={LayoutDashboard} label="Dashboard" active={pathname === "/"} collapsed={collapsed} onNavigate={closeMobile} />

        {/* Network */}
        <NavGroup icon={Network} label="Network" items={networkSubItems} open={networkOpen} setOpen={setNetworkOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />

        {/*
          Voce "Dispositivi" non in sidebar: l'entrypoint unico per host/device
          è Discovery (filtri rapidi per Server/Hypervisor/Client/Router/Switch/Firewall
          previsti in Fase 2). Le pagine /devices/[classification] restano per ora
          come gestione dettagliata; verranno sostituite da azioni inline in Fase 3.
        */}

        {/* Inventario — la voce "Servizi NIS2" compare solo se il modulo è abilitato */}
        <NavGroup icon={Package} label="Inventario" items={enabledModules.has("nis2_inventory") ? inventorySubItems : inventorySubItems.filter((i) => i.href !== "/services")} open={inventoryOpen} setOpen={setInventoryOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />

        {/* Network Services — DNS / DHCP / bridge (solo se il modulo è abilitato) */}
        {enabledModules.has("network_services") && (
          <NavGroup icon={ServerCog} label="Network Services" items={networkServicesSubItems} open={networkServicesOpen} setOpen={setNetworkServicesOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />
        )}

        {/* Launchpad — accesso rapido moduli attivi */}
        <NavItem href="/launchpad" icon={KeyRound} label="Launchpad" active={pathname.startsWith("/launchpad")} collapsed={collapsed} onNavigate={closeMobile} />

        {/* Anomalie */}
        <NavItem href="/analytics" icon={AlertTriangle} label="Anomalie" active={isActive("/analytics")} collapsed={collapsed} onNavigate={closeMobile} badgeCount={unackedAnomalies} />

        {/* Active Directory: spostato come voce di Network */}

        {/* Config Cliente — disabilitato, da rifare con UX guidata */}
        <div
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/40 cursor-not-allowed",
            collapsed && "md:justify-center md:px-0"
          )}
          title="In arrivo"
        >
          <ClipboardList className="h-4 w-4 shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Config Cliente</span>
        </div>

        {/* Patch Management (Chocolatey) — solo se il modulo è abilitato */}
        {enabledModules.has("patch_management") && (
          <NavItem href="/patch-management" icon={ShieldCheck} label="Patch Management" active={isActive("/patch-management")} collapsed={collapsed} onNavigate={closeMobile} />
        )}

        {/* RMM / Controllo remoto (MeshCentral) — solo se il modulo è abilitato */}
        {enabledModules.has("meshcentral") && (
          <NavItem href="/rmm" icon={MonitorSmartphone} label="Controllo remoto" active={isActive("/rmm")} collapsed={collapsed} onNavigate={closeMobile} />
        )}

        {/* Moduli esterni abilitati (LibreNMS / Wazuh / Graylog) — link diretto alla dashboard */}
        {externalModules.map((m) => (
          <a
            key={m.key}
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMobile}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
              collapsed && "md:justify-center md:px-0",
            )}
            title={`${m.label} (apre in nuova scheda)`}
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>{m.label}</span>
          </a>
        ))}

        {/* Manuale in-app: viewer markdown dei doc in /docs */}
        <NavItem href="/manual" icon={BookOpen} label="Manuale" active={isActive("/manual")} collapsed={collapsed} onNavigate={closeMobile} />

        {/* ═══ SEPARATORE SISTEMA (nascosto se collassato) ═══ */}
        <div className={cn("pt-3 px-3", collapsed && "md:hidden")}>
          <div className="border-t border-sidebar-border pt-2">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
              Sistema
            </p>
          </div>
        </div>

        {/* Impostazioni (globale) */}
        <NavItem href="/settings" icon={Settings} label="Impostazioni" active={pathname.startsWith("/settings")} collapsed={collapsed} onNavigate={closeMobile} />

      </nav>

      {/* Footer: toggle collapse (desktop) + Logout */}
      <div className="shrink-0 p-3 border-t border-sidebar-border space-y-1">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Espandi menu" : "Comprimi menu"}
          className={cn(
            "hidden md:flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full",
            collapsed && "md:justify-center md:px-0"
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
          <span className={cn(collapsed && "md:hidden")}>Comprimi menu</span>
        </button>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "Esci" : undefined}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full",
            collapsed && "md:justify-center md:px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Esci</span>
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
          "fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col z-40 transition-[transform,width] duration-200",
          "md:translate-x-0",
          collapsed ? "md:w-16" : "md:w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
