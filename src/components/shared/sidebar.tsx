"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { IstanzaCorrente } from "./tenant-switcher";
import { useSidebar } from "./sidebar-context";
import {
  Activity,
  Cable,
  LayoutDashboard,
  ArrowUpFromLine,
  Network,
  Scan,
  Key,
  Settings,
  ServerCog,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Server,
  ListOrdered,
  Package,
  User,
  Link2,
  FileKey,
  FolderTree,
  Building2,
  ClipboardList,
  Radar,
  Router,
  AlertTriangle,
  ShieldAlert,
  Siren,
  Workflow,
  BookOpen,
  Ban,
  ShieldCheck,
  MonitorSmartphone,
  ExternalLink,
  Bug,
  History,
  LayoutGrid,
  HeartPulse,
  ShieldHalf,
  Globe,
  Wifi,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
  SlidersHorizontal, CalendarClock,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { UserMenu } from "./user-menu";
import { useUrlPerBrowser } from "./url-per-browser";
import { vociApplicativi, type IconaVoce, type ModuloPerMenu } from "@/lib/modules/voci-applicativi";
import { Button } from "@/components/ui/button";

type SubItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Inserisce un separatore visivo PRIMA di questa voce. */
  divider?: string;
  /** Console di un prodotto esterno: nuova scheda (gruppo Applicativi, 19/10). */
  esterno?: boolean;
  /** Numero rosso accanto alla voce (es. allarmi gravi della rete osservata). */
  badge?: number;
};

const ICONE_APPLICATIVI: Record<IconaVoce, LucideIcon> = {
  ShieldCheck, Bug, History, MonitorSmartphone, Activity, ExternalLink,
};

const inventorySubItems: readonly SubItem[] = [
  { href: "/inventory", label: "Asset", icon: Package },
  { href: "/software", label: "Software", icon: Package },
  { href: "/inventory/assignees", label: "Assegnatari", icon: User },
  { href: "/inventory/abbinamenti", label: "Abbinamenti", icon: Link2 },
  { href: "/inventory/locations", label: "Ubicazioni", icon: FolderTree },
  { href: "/inventory/licenses", label: "Licenze", icon: FileKey },
  { href: "/services", label: "Servizi NIS2", icon: Workflow },
] as const;

// Network (Riccardo, 19/10 sera): «Credenziali» con i controller di rete sotto la sua
// intestazione; Vulnerabilità e Alert sicurezza nel gruppo «Sicurezza».
const networkSubItems: readonly SubItem[] = [
  { href: "/networks", label: "Subnet", icon: Network },
  { href: "/discovery", label: "Discovery", icon: Radar },
  { href: "/topology", label: "Topologia", icon: Workflow },
  { href: "/software", label: "Software", icon: Package },
  { href: "/active-directory", label: "Active Directory", icon: FolderTree },
  { href: "/credentials", label: "Credenziali", icon: Key, divider: "Credenziali" },
  { href: "/controllers", label: "Controller di rete", icon: Router },
  { href: "/arp-table", label: "Tabella ARP", icon: ListOrdered, divider: "Diagnostica" },
  { href: "/dhcp/sources", label: "Sorgenti DHCP", icon: Server },
  { href: "/scans", label: "Scansioni", icon: Scan },
  { href: "/excluded-ips", label: "IP esclusi", icon: Ban },
];

// Sicurezza (Riccardo, 19/10 sera): le viste di sicurezza in un gruppo solo. La Health
// di Active Directory è la scheda della pagina AD, aperta già lì. «Reti dal trunk» qui
// dal 25/10 (Riccardo): con i rilievi della sonda passiva è una pagina di sicurezza.
const sicurezzaSubItems: readonly SubItem[] = [
  { href: "/vulnerabilities", label: "Vulnerabilità", icon: ShieldAlert },
  { href: "/security-alerts", label: "Alert sicurezza", icon: Siren },
  { href: "/arp-table/trunk", label: "Reti dal trunk", icon: Cable },
  { href: "/active-directory?tab=health", label: "Health Active Directory", icon: HeartPulse },
];

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
  // Attiva solo la voce più precisa: su /patch-management/cve non anche «Panoramica»
  // (/patch-management), su /inventory/assignees non anche «Asset» (19/10).
  const migliore = items
    .filter((i) => !i.esterno && isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const perBrowser = useUrlPerBrowser();
  return (
    <>
      {items.map((item) => (
        <div key={`${item.href}|${item.label}`}>
          {item.divider && (
            <div className="pt-2 pb-1 px-2.5">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
                {item.divider}
              </p>
            </div>
          )}
          {item.esterno ? (
            <a
              href={perBrowser(item.href)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onNavigate}
              title={`${item.label} (si apre in una scheda nuova)`}
              className={cn("flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors", ITEM_INACTIVE)}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </a>
          ) : (
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                item.href === migliore ? ITEM_ACTIVE : ITEM_INACTIVE
              )}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span
                  title={`${item.badge} allarmi gravi da prendere in carico`}
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#8E1B20] px-1 text-[13px] font-bold leading-none text-white"
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Gruppo collassabile. Espanso: toggle inline con chevron.
 * Collassato (desktop): solo icona + flyout al hover con le sottovoci.
 * Su mobile resta sempre l'espansione inline (collapsed non si applica).
 *
 * Tastiera (analisi del 19/10, F06): da collassato il flyout dipendeva solo dal
 * mouse; Invio cambiava `open`, ma il ramo inline è nascosto su desktop e le
 * sottovoci restavano invisibili. Ora Invio/Spazio aprono e chiudono il flyout,
 * Tab ci entra (sta subito dopo il pulsante), Escape lo chiude e torna al pulsante,
 * e si chiude quando il fuoco esce dal gruppo.
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
  const flyoutDesktop = () => collapsed && typeof window !== "undefined" && window.innerWidth >= 768;

  return (
    <div
      className="pt-1 relative"
      onMouseEnter={showFlyout}
      onMouseLeave={hideFlyout}
      onKeyDown={(e) => {
        if (e.key === "Escape" && flyout) {
          e.stopPropagation();
          hideFlyout();
          btnRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (flyout && !e.currentTarget.contains(e.relatedTarget as Node | null)) hideFlyout();
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (flyoutDesktop()) {
            if (flyout) hideFlyout();
            else showFlyout();
            return;
          }
          setOpen((o) => !o);
        }}
        aria-expanded={flyoutDesktop() ? flyout !== null : open}
        aria-haspopup={collapsed ? "menu" : undefined}
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
            <SubList items={items} isActive={isActive} onNavigate={() => { hideFlyout(); onNavigate(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { collapsed, toggle } = useSidebar();
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const isSuperadmin = userRole === "superadmin";
  const isAdmin = isSuperadmin || userRole === "admin";
  const tenantCode = (session?.user as { tenantCode?: string } | undefined)?.tenantCode;
  const tenants = ((session?.user as Record<string, unknown>)?.tenants ?? []) as Array<{ code: string; name: string }>;
  const currentTenantName = tenantCode === "__ALL__"
    ? "Tutte le istanze"
    : tenants.find((t) => t.code === tenantCode)?.name ?? tenantCode ?? "";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(() =>
    !pathname.startsWith("/arp-table/trunk") && networkSubItems.some((d) => pathname.startsWith(d.href))
  );
  const [sicurezzaOpen, setSicurezzaOpen] = useState(() =>
    ["/vulnerabilities", "/security-alerts", "/arp-table/trunk"].some((h) => pathname.startsWith(h)) ||
      (pathname === "/active-directory" && searchParams.get("tab") === "health")
  );
  const [inventoryOpen, setInventoryOpen] = useState(() =>
    inventorySubItems.some((d) => pathname.startsWith(d.href))
  );
  const [networkServicesOpen, setNetworkServicesOpen] = useState(() =>
    networkServicesSubItems.some((d) => pathname.startsWith(d.href))
  );
  const [unackedAnomalies, setUnackedAnomalies] = useState(0);
  const [allarmiRete, setAllarmiRete] = useState(0);
  const sicurezzaItems = useMemo<SubItem[]>(
    () => sicurezzaSubItems.map((v) => (v.href === "/arp-table/trunk" ? { ...v, badge: allarmiRete } : v)),
    [allarmiRete],
  );
  // Moduli abilitati: fonte unica = registry (/api/modules). Ogni voce di menu
  // dei moduli compare SOLO se il modulo è enabled per il tenant.
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [moduliMenu, setModuliMenu] = useState<ModuloPerMenu[]>([]);
  // Pannello Zabbix (passo 7.4): fuori dal catalogo dei moduli, in menu solo se acquistato, configurato e acceso.
  const [pannelloZabbix, setPannelloZabbix] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const applicativiItems = useMemo<SubItem[]>(
    () => vociApplicativi(moduliMenu, pannelloZabbix).map((v) => ({ href: v.href, label: v.label, icon: ICONE_APPLICATIVI[v.icona], divider: v.divider, esterno: v.esterno })),
    [moduliMenu, pannelloZabbix],
  );
  const [applicativiOpen, setApplicativiOpen] = useState(() =>
    ["/patch-management", "/rmm", "/zabbix"].some((h) => pathname.startsWith(h))
  );

  useEffect(() => {
    if (!tenantCode || tenantCode === "__ALL__") {
      setEnabledModules(new Set());
      setModuliMenu([]);
      setPannelloZabbix(false);
      return;
    }
    fetch("/api/modules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules?: ModuloPerMenu[]; pannelli?: { zabbix?: boolean } } | null) => {
        const mods = d?.modules ?? [];
        setPannelloZabbix(d?.pannelli?.zabbix === true);
        setEnabledModules(new Set(mods.filter((m) => m.enabled).map((m) => m.key)));
        setModuliMenu(mods);
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
      fetch("/api/trunk/rilievi?conteggio=1")
        .then((r) => r.ok ? r.json() : null)
        .then((data: { allarmiAlti?: number } | null) => {
          if (data?.allarmiAlti != null) setAllarmiRete(data.allarmiAlti);
        })
        .catch(() => { /* non critico */ });
    };
    fetchUnacked();
    intervalRef.current = setInterval(fetchUnacked, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Una voce con la query (es. /active-directory?tab=health) vale solo con quella query.
  const attivaConQuery = (href: string) => {
    const [p, q] = href.split("?");
    return pathname === p && new URLSearchParams(q).get("tab") === searchParams.get("tab");
  };
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.includes("?")) return attivaConQuery(href);
    // Sulla Health di AD non si accende anche «Active Directory» in Network (20/10).
    if (sicurezzaSubItems.some((v) => v.href.includes("?") && v.href.split("?")[0] === href && attivaConQuery(v.href))) return false;
    // Sulle Reti dal trunk non si accende anche «Tabella ARP».
    if (href === "/arp-table" && pathname.startsWith("/arp-table/trunk")) return false;
    return pathname.startsWith(href);
  };
  const closeMobile = () => setMobileOpen(false);

  const nav = (
    <>
      {/* Testata (Riccardo, 23/10): logo piccolo, nome e «Comprimi» in una riga, sotto l'utente
          (nel suo menu anche «Esci»). Prima logo grande in alto e tema, comprimi, utente, esci in un blocco in fondo. */}
      <div className="shrink-0 border-b border-sidebar-border">
        <div className={cn("flex items-center gap-2 h-12 pl-14 pr-2 md:pl-4", collapsed && "md:flex-col md:h-auto md:py-3 md:px-0")}>
          <img
            src="/logo-white.png"
            alt="Domarc"
            className={cn("h-6 w-auto object-contain", collapsed && "md:hidden")}
          />
          {/* A menu compresso solo il simbolo (Riccardo, 23/10): il logo intero a 44 px non si leggeva. */}
          <img
            src="/simbolo-domarc.png"
            alt="Domarc"
            className={cn("h-6 w-6 object-contain", collapsed ? "hidden md:block" : "hidden")}
          />
          <span className={cn("w-px h-5 bg-sidebar-border", collapsed && "md:hidden")} />
          <span title="IP Address Management" className={cn("flex-1 truncate font-semibold text-sidebar-foreground", collapsed && "md:hidden")}>
            DA-IPAM
          </span>
          {/* Con il bordo perché si veda che è un comando, non un ornamento (Riccardo, 23/10). */}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Espandi menu" : "Comprimi menu"}
            aria-label={collapsed ? "Espandi menu" : "Comprimi menu"}
            className="hidden md:grid h-8 w-8 shrink-0 place-items-center rounded-md border border-sidebar-border text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <div className={cn("px-2 pb-2", collapsed && "md:px-0")}>
          <UserMenu compresso={collapsed} />
          {/* Su quale istanza si lavora; la scelta è in Impostazioni → Istanza (Riccardo, 23/10). */}
          <IstanzaCorrente compresso={collapsed} onNavigate={closeMobile} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">

        {/* ═══ GESTIONE ISTANZE (solo superadmin) ═══ */}
        {/* «URL dell'hub» è in Impostazioni → Sistema dal 23/10 (Riccardo: quasi inutile qui). */}
        {isSuperadmin && (
          <NavItem href="/tenants" icon={Building2} label="Istanze" active={isActive("/tenants")} collapsed={collapsed} onNavigate={closeMobile} />
        )}

        {/* ═══ SEPARATORE DATI ISTANZA (nascosto se collassato); la scelta è in Impostazioni ═══ */}
        {currentTenantName && (
          <div className={cn("pt-3 pb-1 px-3", collapsed && "md:hidden")}>
            <div className="border-t border-sidebar-border pt-2">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold">
                Dati istanza
              </p>
            </div>
          </div>
        )}

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

        {/* Sicurezza (Riccardo, 19/10 sera): Vulnerabilità, Alert sicurezza, Health AD */}
        <NavGroup icon={ShieldHalf} label="Sicurezza" items={sicurezzaItems} open={sicurezzaOpen} setOpen={setSicurezzaOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />
        {/* Inventario — la voce "Servizi NIS2" compare solo se il modulo è abilitato */}
        <NavGroup icon={Package} label="Inventario" items={enabledModules.has("nis2_inventory") ? inventorySubItems : inventorySubItems.filter((i) => i.href !== "/services")} open={inventoryOpen} setOpen={setInventoryOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />

        {/* Network Services — DNS / DHCP / bridge (solo se il modulo è abilitato) */}
        {enabledModules.has("network_services") && (
          <NavGroup icon={ServerCog} label="Network Services" items={networkServicesSubItems} open={networkServicesOpen} setOpen={setNetworkServicesOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />
        )}
        {/* Applicativi (Riccardo, 19/10): al posto del Launchpad a tessere e delle voci sparse
            dei moduli. Ogni prodotto con le sue pagine interne e la sua console. */}
        <NavGroup icon={LayoutGrid} label="Applicativi" items={applicativiItems} open={applicativiOpen} setOpen={setApplicativiOpen} collapsed={collapsed} isActive={isActive} onNavigate={closeMobile} />


        {/* Anomalie */}
        <NavItem href="/analytics" icon={AlertTriangle} label="Anomalie" active={isActive("/analytics")} collapsed={collapsed} onNavigate={closeMobile} badgeCount={unackedAnomalies} />

        {/* Active Directory: spostato come voce di Network */}

        {/* Config istanza — disabilitato, da rifare con UX guidata */}
        <div
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/40 cursor-not-allowed",
            collapsed && "md:justify-center md:px-0"
          )}
          title="In arrivo"
        >
          <ClipboardList className="h-4 w-4 shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Config istanza</span>
        </div>

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
        <NavItem href="/settings" icon={Settings} label="Impostazioni" active={pathname.startsWith("/settings") && !pathname.startsWith("/settings/cosa-esce") && !pathname.startsWith("/settings/opzioni") && !pathname.startsWith("/settings/schedulazioni")} collapsed={collapsed} onNavigate={closeMobile} />

        {/* Opzioni (22/10): ogni funzione che si accende o si spegne, in un posto solo; chi non è admin la vede ferma */}
        <NavItem href="/settings/opzioni" icon={SlidersHorizontal} label="Opzioni" active={pathname.startsWith("/settings/opzioni")} collapsed={collapsed} onNavigate={closeMobile} />

        {/* Schedulazioni (23/10): tutto ciò che parte da solo, in un elenco; chi non è admin lo vede fermo */}
        <NavItem href="/settings/schedulazioni" icon={CalendarClock} label="Schedulazioni" active={pathname.startsWith("/settings/schedulazioni")} collapsed={collapsed} onNavigate={closeMobile} />

        {/* Cosa esce verso Domarc (DA-Link, tappa C1): solo gli amministratori dell'istanza */}
        {isAdmin && (
          <NavItem href="/settings/cosa-esce" icon={ArrowUpFromLine} label="Cosa esce" active={pathname.startsWith("/settings/cosa-esce")} collapsed={collapsed} onNavigate={closeMobile} />
        )}

      </nav>

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
