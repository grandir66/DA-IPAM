import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpDown, BookOpen, Boxes,
  Camera, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert,
  CircleCheck, CircleHelp, CircleOff, ClipboardCopy, Columns3, Copy, Database, DoorOpen, Download, Eraser,
  ExternalLink, Eye, EyeOff, FileText, Filter, Fingerprint, FolderOpen, Globe, History, Info, KeyRound,
  LayoutDashboard, LayoutGrid, Link2, List, ListChecks, LocateFixed, Lock, LogOut, Menu, Merge, Microscope, Minus,
  Monitor, MonitorSmartphone, Moon, MoreHorizontal, MoreVertical, MoveHorizontal, MoveVertical, Network, Package,
  PackagePlus, PanelLeftClose, PanelLeftOpen, Pause, Pencil, Phone, Pin, Play, Plug, Plus, PlusCircle, Power,
  Printer, Radar, Radio, RadioTower, RefreshCw, Rocket, RotateCcw, RotateCw, Save, Scan, Search, Send, Server,
  ServerCog, Settings, Settings2, Shield, ShieldCheck, ShieldQuestion, Smartphone, Sparkles, Split,
  SquareChevronRight, Sun, Tag, Tags, Terminal, TerminalSquare, TestTube, Trash2, TriangleAlert, Upload, UserCheck,
  UserX, Users, Wand2, Wifi, Wrench, X, Zap,
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
  "alert-triangle": AlertTriangle, "arrow-left": ArrowLeft, "arrow-left-right": ArrowLeftRight,
  "arrow-right": ArrowRight, camera: Camera, "check-circle": CheckCircle2, "circle-alert": CircleAlert,
  "circle-check": CircleCheck, "circle-help": CircleHelp, "circle-off": CircleOff, "clipboard-copy": ClipboardCopy,
  database: Database, "door-open": DoorOpen, eraser: Eraser, eye: Eye, fingerprint: Fingerprint,
  "folder-open": FolderOpen, history: History, info: Info, "layout-grid": LayoutGrid, list: List,
  "list-checks": ListChecks, "locate-fixed": LocateFixed, microscope: Microscope, minus: Minus,
  "monitor-smartphone": MonitorSmartphone, "move-horizontal": MoveHorizontal, "move-vertical": MoveVertical,
  pause: Pause, phone: Phone, pin: Pin, play: Play, plug: Plug, plus: Plus, power: Power, printer: Printer,
  radar: Radar, radio: Radio, "radio-tower": RadioTower, rocket: Rocket, "rotate-ccw": RotateCcw,
  "rotate-cw": RotateCw, save: Save, scan: Scan, send: Send, server: Server, "server-cog": ServerCog,
  "settings-2": Settings2, "shield-question": ShieldQuestion, smartphone: Smartphone, sparkles: Sparkles,
  "square-chevron-right": SquareChevronRight, tag: Tag, tags: Tags, "terminal-square": TerminalSquare,
  "test-tube": TestTube, "triangle-alert": TriangleAlert, upload: Upload, "user-check": UserCheck, "user-x": UserX,
  users: Users, wand: Wand2, wifi: Wifi, zap: Zap,
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
