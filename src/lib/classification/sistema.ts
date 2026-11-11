/**
 * Il sistema di un apparato come attributo a sé, accanto alla categoria (Riccardo, 11/11/2026: «distinguere tra
 * PC Windows, Linux e OSX… come per i server… VM server Windows, VM server Linux»). Non sono classi nuove: il
 * 21/10 «Server Windows» e «Server Linux» erano diventati «Server» più il sistema a parte, e così resta. Qui il
 * sistema si legge da ciò che c'è già e diventa un filtro che vale per ogni categoria. Modulo puro.
 */
export type Sistema = "windows" | "linux" | "macos" | "rete";

export const SISTEMI: ReadonlyArray<{ valore: Sistema; etichetta: string }> = [
  { valore: "windows", etichetta: "Windows" },
  { valore: "linux", etichetta: "Linux" },
  { valore: "macos", etichetta: "macOS" },
  { valore: "rete", etichetta: "Sistema di rete" },
];

export function etichettaSistema(s: Sistema | null): string | null {
  return SISTEMI.find((x) => x.valore === s)?.etichetta ?? null;
}

export interface HostPerSistema {
  /** La famiglia decisa dal motore (`hosts.attr_os_family`): vale per prima. */
  attr_os_family?: string | null;
  /** La famiglia ricavata dal testo (`hosts.os_family`, colonna generata): Windows, Linux, Apple, Unknown. */
  os_family?: string | null;
  /** Il testo grezzo letto da nmap, SNMP o dagli agenti. */
  os_info?: string | null;
}

function daFamiglia(f: string | null | undefined): Sistema | null {
  switch ((f ?? "").trim().toLowerCase()) {
    case "windows": return "windows";
    case "linux": return "linux";
    case "macos":
    case "apple": return "macos";
    case "network-os": return "rete";
    default: return null;
  }
}

function daTesto(t: string | null | undefined): Sistema | null {
  const s = (t ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (s.includes("windows")) return "windows";
  if (/\b(mac ?os|os ?x|darwin)\b/.test(s)) return "macos";
  if (/\b(routeros|ios-xe|junos|fortios|edgeos|airos)\b/.test(s)) return "rete";
  if (/\b(linux|ubuntu|debian|centos|red ?hat|rhel|suse|proxmox|synology dsm)\b/.test(s)) return "linux";
  return null;
}

/** Il sistema dell'apparato, o null se non si sa. Vale il motore, poi la famiglia dal testo, poi il testo grezzo. */
export function sistemaDi(h: HostPerSistema): Sistema | null {
  return daFamiglia(h.attr_os_family) ?? daFamiglia(h.os_family) ?? daTesto(h.os_info);
}

/** Filtro: vuoto = tutti; `__ignoto__` = quelli di cui non si sa il sistema; altrimenti il sistema. */
export const SISTEMA_IGNOTO = "__ignoto__";

export function passaFiltroSistema(filtro: string | null | undefined, h: HostPerSistema): boolean {
  if (!filtro) return true;
  const s = sistemaDi(h);
  return filtro === SISTEMA_IGNOTO ? s == null : s === filtro;
}
