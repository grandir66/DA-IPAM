/**
 * Etichette del lanciatore: niente Node, niente database. Le usa anche il client.
 */
export const TIPI_GIRO = ["discovery", "segmentazione", "sonda_l2", "controlli"] as const;
export type TipoGiro = (typeof TIPI_GIRO)[number];

export const PROFILI_GIRO = ["rapido", "standard", "completo", "lento", "su_misura"] as const;
export type ProfiloGiro = (typeof PROFILI_GIRO)[number];

export const FASI_GIRO = ["host", "porte", "udp", "sonde"] as const;
export type FaseGiro = (typeof FASI_GIRO)[number];

export const SCAN_MODE_GIRO = ["auto", "syn", "connect"] as const;
export type ScanModeGiro = (typeof SCAN_MODE_GIRO)[number];

export const PRESET_PORTE_GIRO = ["top100", "top1000", "all"] as const;
export type PresetPorteGiro = (typeof PRESET_PORTE_GIRO)[number];

export const SRC_PORT_GIRO = [53, 88, 123, 20, 67, 500] as const;

export const PROTOCOLLI_SEG = ["direct", "icmp_echo", "ipv6", "fragmented_syn"] as const;
export type ProtocolloSeg = (typeof PROTOCOLLI_SEG)[number];

export const TIPI_GIRO_UI: Record<TipoGiro, { nome: string; riga: string }> = {
  discovery: { nome: "Discovery", riga: "Host, porte, servizi, identità" },
  segmentazione: { nome: "Segmentazione", riga: "Dalla VLAN prova i servizi delle altre reti" },
  sonda_l2: { nome: "Sonda L2", riga: "Ascolto CDP, LLDP, STP e tag 802.1Q sul trunk" },
  controlli: { nome: "Solo controlli", riga: "Rifà sonde, identità e controlli, senza nmap" },
};

export const PROFILI_GIRO_UI: Record<ProfiloGiro, { nome: string; riga: string }> = {
  rapido: { nome: "Rapido", riga: "Le 100 porte TCP più comuni" },
  standard: { nome: "Standard", riga: "1000 TCP + 20 UDP, riconoscimento, identità, controlli" },
  completo: { nome: "Completo", riga: "Tutte le 65.535 porte TCP. Non parte da solo." },
  lento: { nome: "Lento", riga: "Come lo Standard, 300 pacchetti al secondo" },
  su_misura: { nome: "Su misura", riga: "Scegli le fasi: host, porte, UDP, sonde" },
};

export function eTipoGiro(v: string): v is TipoGiro {
  return (TIPI_GIRO as readonly string[]).includes(v);
}

export function eProfiloGiro(v: string): v is ProfiloGiro {
  return (PROFILI_GIRO as readonly string[]).includes(v);
}

export function fasiValide(fasi: string[] | undefined): FaseGiro[] {
  if (!fasi?.length) return [...FASI_GIRO];
  const ok = fasi.filter((f): f is FaseGiro => (FASI_GIRO as readonly string[]).includes(f));
  return ok.length ? [...new Set(ok)] : [...FASI_GIRO];
}
