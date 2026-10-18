/**
 * Porte per RDP/VNC senza agente (senza-agente.ts). Modulo puro, senza DB:
 * lo usa anche la lista /discovery lato client.
 */
export type ProtocolloRemoto = "rdp" | "vnc";

/** Porte cercate fra quelle aperte dell'host, in ordine di preferenza. */
const PORTE: Record<ProtocolloRemoto, readonly number[]> = {
  rdp: [3389],
  vnc: [5900, 5901, 5902],
};

/** open_ports è JSON: numeri o {port, protocol}. Illeggibile → nessuna porta. */
export function porteAperte(openPortsJson: string | null): number[] {
  if (!openPortsJson) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(openPortsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: number[] = [];
  for (const p of arr) {
    if (typeof p === "number") out.push(p);
    else if (p && typeof p === "object") {
      const o = p as { port?: unknown; protocol?: unknown };
      if (typeof o.port === "number" && (o.protocol == null || o.protocol === "tcp")) out.push(o.port);
    }
  }
  return out;
}

/** Prima porta aperta per il protocollo, o null. */
export function portaPer(protocollo: ProtocolloRemoto, porte: number[]): number | null {
  return PORTE[protocollo].find((p) => porte.includes(p)) ?? null;
}

/**
 * Quali pulsanti mostrare nella scheda host: le porte trovate dalla scansione e,
 * per RDP, anche ogni host Windows (la scansione veloce può non vedere la 3389).
 */
export function protocolliDisponibili(
  openPortsJson: string | null,
  osFamily: string | null = null,
): Record<ProtocolloRemoto, boolean> {
  const porte = porteAperte(openPortsJson);
  return {
    rdp: portaPer("rdp", porte) !== null || osFamily === "Windows",
    vnc: portaPer("vnc", porte) !== null,
  };
}

/** Porta da usare per la sessione: quella trovata, altrimenti la standard. */
export function portaSessione(protocollo: ProtocolloRemoto, porte: number[]): number {
  return portaPer(protocollo, porte) ?? PORTE[protocollo][0];
}
