/**
 * Le icone della mappa: il set approvato da Riccardo il 13/10 (forme e
 * significato del set Cisco, colori Domarc presi dai token del tema). Si
 * disegnano una volta come <symbol> (`TopologyIconDefs`, una sola volta nella
 * pagina) e si richiamano con `TopoIcon`. Switch e switch L3 si distinguono a
 * 20 px: l'L3 ha il riquadro giallo «L3» in basso a destra, che cambia la sagoma.
 */
import type { CSSProperties } from "react";

export type TopoIconId =
  | "router" | "switch" | "switch3" | "firewall" | "ap" | "server" | "hyper"
  | "nas" | "phone" | "printer" | "cam" | "cloud" | "client";

const BY_TYPE: Readonly<Record<string, TopoIconId>> = {
  router: "router", vpn_gateway: "router", modem: "router", ont: "router",
  switch: "switch", switch_l3: "switch3", l3_switch: "switch3", core_switch: "switch3",
  firewall: "firewall", proxy: "firewall", load_balancer: "firewall",
  access_point: "ap",
  server: "server", server_linux: "server", server_windows: "server", vm: "server", web_server: "server",
  mail_server: "server", dns_server: "server", dhcp_server: "server", database_server: "server", nfs_server: "server",
  hypervisor: "hyper",
  nas: "nas", storage: "nas",
  voip: "phone",
  stampante: "printer", multifunzione: "printer", fotocopiatrice: "printer", scanner: "printer",
  telecamera: "cam",
  internet: "cloud", wan: "cloud",
};

export function iconFor(type: string): TopoIconId {
  return BY_TYPE[type] ?? "client";
}

const TIPO: Readonly<Record<string, string>> = {
  router: "router", switch: "switch", switch_l3: "switch L3", l3_switch: "switch L3", core_switch: "switch L3",
  firewall: "firewall", access_point: "access point", hypervisor: "hypervisor", server: "server",
  server_linux: "server Linux", server_windows: "server Windows", nas: "NAS", storage: "storage", vm: "macchina virtuale",
  workstation: "PC", notebook: "portatile", voip: "telefono IP", stampante: "stampante", multifunzione: "multifunzione",
  telecamera: "telecamera", unknown: "sconosciuto", ups: "UPS",
};

/** Il tipo in parole, per le righe e il pannello. */
export function typeLabel(type: string): string {
  return TIPO[type] ?? type.replace(/_/g, " ");
}

// Colori dai token del tema (globals.css): navy = testo, bianco = superficie, cian = primario, giallo = accento.
const N: CSSProperties = { fill: "var(--foreground)" };
const NT: CSSProperties = { fill: "var(--foreground)", fillOpacity: 0.78, stroke: "var(--card)", strokeWidth: 1 };
const W: CSSProperties = { fill: "var(--card)" };
const LW = (w: number): CSSProperties => ({ stroke: "var(--card)", strokeWidth: w, fill: "none" });
const LN = (w: number): CSSProperties => ({ stroke: "var(--foreground)", strokeWidth: w, fill: "none" });
const C: CSSProperties = { fill: "var(--primary)" };

export function TopologyIconDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {/* router: disco con quattro frecce */}
        <symbol id="topo-i-router" viewBox="0 0 48 48">
          <ellipse cx="24" cy="30" rx="20" ry="8" style={N} />
          <rect x="4" y="20" width="40" height="10" style={N} />
          <ellipse cx="24" cy="20" rx="20" ry="8" style={NT} />
          <g style={LW(2)}>
            <path d="M24 14v12M20 17l4-3 4 3M20 23l4 3 4-3" />
            <path d="M14 20h20M17 17l-3 3 3 3M31 17l3 3-3 3" />
          </g>
        </symbol>
        {/* switch: parallelepipedo con frecce incrociate */}
        <symbol id="topo-i-switch" viewBox="0 0 48 48">
          <path d="M4 18 L12 10 H44 L36 18 Z" style={NT} />
          <rect x="4" y="18" width="32" height="18" style={N} />
          <path d="M36 18 L44 10 V28 L36 36 Z" style={{ ...N, stroke: "var(--card)", strokeWidth: 1 }} />
          <g style={LW(1.8)}><path d="M14 12h18M28 10l4 2-4 2M30 16H12M16 14l-4 2 4 2" /></g>
        </symbol>
        {/* switch L3: lo switch con la freccia in su e il riquadro «L3» */}
        <symbol id="topo-i-switch3" viewBox="0 0 48 48">
          <use href="#topo-i-switch" />
          <g style={{ stroke: "var(--primary)", strokeWidth: 2.4, fill: "none" }}><path d="M16 34V24M12 28l4-4 4 4" /></g>
          <rect x="24" y="28" width="24" height="19" rx="2" style={{ fill: "var(--accent)", stroke: "var(--foreground)", strokeWidth: 1.5 }} />
          <text x="36" y="43" textAnchor="middle" style={{ fill: "var(--foreground)", fontSize: 15, fontWeight: 700 }}>L3</text>
        </symbol>
        {/* firewall: muro di mattoni */}
        <symbol id="topo-i-firewall" viewBox="0 0 48 48">
          <rect x="6" y="8" width="36" height="32" style={N} />
          <g style={LW(1.6)}><path d="M6 16h36M6 24h36M6 32h36M18 8v8M30 8v8M12 16v8M24 16v8M36 16v8M18 24v8M30 24v8M12 32v8M24 32v8M36 32v8" /></g>
        </symbol>
        {/* access point: disco piatto con onde */}
        <symbol id="topo-i-ap" viewBox="0 0 48 48">
          <ellipse cx="24" cy="32" rx="16" ry="6" style={N} />
          <g style={LN(2.4)}><path d="M16 22a11 11 0 0 1 16 0M12 17a17 17 0 0 1 24 0M20 27a5 5 0 0 1 8 0" /></g>
        </symbol>
        {/* server: torre */}
        <symbol id="topo-i-server" viewBox="0 0 48 48">
          <rect x="14" y="6" width="20" height="36" rx="2" style={N} />
          <g style={LW(1.6)}><path d="M18 13h12M18 19h12M18 25h12" /></g>
          <circle cx="24" cy="35" r="2" style={C} />
        </symbol>
        {/* hypervisor: riquadri delle VM */}
        <symbol id="topo-i-hyper" viewBox="0 0 48 48">
          <rect x="8" y="8" width="32" height="32" rx="3" style={N} />
          <g style={W}><rect x="13" y="13" width="9" height="9" /><rect x="26" y="13" width="9" height="9" /><rect x="13" y="26" width="9" height="9" /></g>
          <rect x="26" y="26" width="9" height="9" style={C} />
        </symbol>
        {/* NAS / storage: dischi impilati */}
        <symbol id="topo-i-nas" viewBox="0 0 48 48">
          <g style={{ ...N, stroke: "var(--card)", strokeWidth: 1 }}>
            <ellipse cx="24" cy="34" rx="16" ry="6" /><rect x="8" y="22" width="32" height="12" />
            <ellipse cx="24" cy="22" rx="16" ry="6" /><rect x="8" y="12" width="32" height="10" />
            <ellipse cx="24" cy="12" rx="16" ry="6" />
          </g>
        </symbol>
        {/* telefono IP */}
        <symbol id="topo-i-phone" viewBox="0 0 48 48">
          <rect x="10" y="20" width="28" height="18" rx="3" style={N} />
          <path d="M12 20c0-8 24-8 24 0" style={LN(5)} />
          <g style={W}>
            <circle cx="18" cy="27" r="1.6" /><circle cx="24" cy="27" r="1.6" /><circle cx="30" cy="27" r="1.6" />
            <circle cx="18" cy="32" r="1.6" /><circle cx="24" cy="32" r="1.6" /><circle cx="30" cy="32" r="1.6" />
          </g>
        </symbol>
        {/* stampante */}
        <symbol id="topo-i-printer" viewBox="0 0 48 48">
          <rect x="14" y="8" width="20" height="10" style={{ ...W, stroke: "var(--foreground)", strokeWidth: 2 }} />
          <rect x="6" y="18" width="36" height="16" rx="3" style={N} />
          <rect x="14" y="30" width="20" height="10" style={{ ...W, stroke: "var(--foreground)", strokeWidth: 2 }} />
        </symbol>
        {/* telecamera */}
        <symbol id="topo-i-cam" viewBox="0 0 48 48">
          <rect x="8" y="16" width="26" height="16" rx="3" style={N} />
          <path d="M34 20l8-4v16l-8-4z" style={N} />
          <circle cx="18" cy="24" r="4" style={C} />
        </symbol>
        {/* Internet / WAN */}
        <symbol id="topo-i-cloud" viewBox="0 0 48 48">
          <path d="M14 36h22a8 8 0 0 0 0-16 11 11 0 0 0-21-3A9 9 0 0 0 14 36z" style={{ ...W, stroke: "var(--foreground)", strokeWidth: 2.4 }} />
        </symbol>
        {/* client */}
        <symbol id="topo-i-client" viewBox="0 0 48 48">
          <rect x="8" y="10" width="32" height="22" rx="2" style={N} />
          <rect x="12" y="14" width="24" height="14" style={W} />
          <path d="M18 38h12M24 32v6" style={LN(3)} />
        </symbol>
      </defs>
    </svg>
  );
}

export function TopoIcon({ type, size, className }: { type: string; size: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <use href={`#topo-i-${iconFor(type)}`} width={size} height={size} />
    </svg>
  );
}
