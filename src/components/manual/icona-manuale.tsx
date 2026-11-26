import {
  Activity, ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Boxes, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft,
  ChevronsRight, Columns3, Copy, Download, ExternalLink, EyeOff, FileText, Filter, Globe, KeyRound, LayoutDashboard,
  Check, Link2, Lock, LogOut, Menu, Merge, Monitor, Moon, MoreHorizontal, MoreVertical, Network, Package, PanelLeftClose,
  PackagePlus, PanelLeftOpen, Pencil, PlusCircle, Split, RefreshCw, Search, Settings, Shield, ShieldCheck, Sun, Terminal, Trash2, Wrench, X,
  type LucideIcon,
} from "lucide-react";
import type { NomeIcona } from "@/lib/manuale/icone";
import { cn } from "@/lib/utils";

/** Le stesse icone delle pagine (lucide), una per nome di `NOMI_ICONE`: il tipo obbliga a tenerle allineate. */
const ICONE: Record<NomeIcona, LucideIcon> = {
  search: Search, filter: Filter, columns: Columns3, download: Download, refresh: RefreshCw, x: X,
  "more-vertical": MoreVertical, pencil: Pencil, "external-link": ExternalLink, "arrow-up-down": ArrowUpDown,
  "arrow-up": ArrowUp, "arrow-down": ArrowDown, copy: Copy, "eye-off": EyeOff,
  wrench: Wrench, package: Package, activity: Activity, shield: Shield, "shield-check": ShieldCheck,
  "plus-circle": PlusCircle, monitor: Monitor, terminal: Terminal, link: Link2, globe: Globe, key: KeyRound,
  trash: Trash2, "file-text": FileText, boxes: Boxes, "package-plus": PackagePlus, check: Check, merge: Merge, split: Split,
  "panel-close": PanelLeftClose, "panel-open": PanelLeftOpen, "more-horizontal": MoreHorizontal,
  "chevron-right": ChevronRight, "chevron-down": ChevronDown, lock: Lock, menu: Menu, moon: Moon, sun: Sun,
  "log-out": LogOut, dashboard: LayoutDashboard, network: Network, book: BookOpen, settings: Settings,
  "chevrons-left": ChevronsLeft, "chevron-left": ChevronLeft, "chevrons-right": ChevronsRight,
};

/** Il segno nel testo del manuale: da solo, o dentro un pulsante disegnato come quelli delle pagine. */
export function IconaManuale({ nome, tasto }: { nome: NomeIcona; tasto: boolean }) {
  const Icona = ICONE[nome];
  return (
    <span
      role="img"
      aria-label={nome}
      className={cn(
        "not-prose mx-0.5 inline-flex items-center justify-center align-[-0.2em] text-foreground",
        tasto && "size-7 rounded-md border border-border bg-background shadow-xs align-middle",
      )}
    >
      <Icona className="size-4" />
    </span>
  );
}
