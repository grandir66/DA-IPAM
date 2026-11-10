import { isIPv4 } from "node:net";
import { isVirtualMac, normalizeMac } from "@/lib/devices/mac-virtuali";

export interface PortaOsservata {
  protocollo: "tcp" | "udp";
  porta: number;
  esito: "aperta" | "chiusa" | "ignota";
}

export interface HostOsservatoNelGiro {
  ip: string;
  mac?: string | null;
  porte?: readonly PortaOsservata[];
}

export interface StatoGiroRete {
  id: string;
  tenant: string;
  reteId: number;
  /** Firma del perimetro effettivo, inclusi sonda, CIDR, target ed esclusioni. */
  perimetro: string;
  fineMs: number;
  esito: "riuscito" | "parziale" | "fallito" | "annullato";
  /** IP per cui la fase host ha prodotto un esito confrontabile nel giro. */
  ipVerificati: readonly string[];
  host: readonly HostOsservatoNelGiro[];
}

export type EventoConfrontoGiri =
  | { tipo: "host_nuovo"; ip: string; mac: string }
  | { tipo: "mac_cambiato"; ip: string; prima: string; dopo: string }
  | { tipo: "porta_nuova" | "porta_rilevata"; ip: string; protocollo: PortaOsservata["protocollo"]; porta: number };

export type EsitoConfrontoGiri =
  | { stato: "non_confrontabile"; motivo: "giro_non_riuscito" | "perimetro_diverso" | "ordine_non_valido" }
  | { stato: "confrontabile"; eventi: EventoConfrontoGiri[] };

function macOsservato(valore: string | null | undefined): string | null {
  const mac = normalizeMac(valore);
  if (!mac || mac === "00:00:00:00:00:00" || isVirtualMac(mac)) return null;
  return (Number.parseInt(mac.slice(0, 2), 16) & 1) === 0 ? mac : null;
}

function hostPerIp(host: readonly HostOsservatoNelGiro[]) {
  const mappa = new Map<string, HostOsservatoNelGiro | null>();
  for (const h of host) {
    if (isIPv4(h.ip)) mappa.set(h.ip, mappa.has(h.ip) ? null : h);
  }
  return mappa;
}

function contaMac(host: readonly HostOsservatoNelGiro[]): Map<string, number> {
  const mappa = new Map<string, number>();
  for (const h of host) {
    const mac = macOsservato(h.mac);
    if (mac) mappa.set(mac, (mappa.get(mac) ?? 0) + 1);
  }
  return mappa;
}

function portePerChiave(porte: readonly PortaOsservata[] | undefined) {
  const mappa = new Map<string, PortaOsservata>();
  for (const p of porte ?? []) {
    if (!Number.isInteger(p.porta) || p.porta < 1 || p.porta > 65535) continue;
    const chiave = `${p.protocollo}:${p.porta}`;
    const precedente = mappa.get(chiave);
    mappa.set(chiave, precedente && precedente.esito !== p.esito ? { ...p, esito: "ignota" } : p);
  }
  return mappa;
}

/** Confronta osservazioni del giro. I campi cumulativi di inventario non sono un input. */
export function confrontaGiriRete(prima: StatoGiroRete, dopo: StatoGiroRete): EsitoConfrontoGiri {
  if (prima.esito !== "riuscito" || dopo.esito !== "riuscito") {
    return { stato: "non_confrontabile", motivo: "giro_non_riuscito" };
  }
  if (!prima.tenant || prima.tenant !== dopo.tenant || prima.reteId !== dopo.reteId ||
      !prima.perimetro || prima.perimetro !== dopo.perimetro) {
    return { stato: "non_confrontabile", motivo: "perimetro_diverso" };
  }
  if (!prima.id || !dopo.id || prima.id === dopo.id ||
      !Number.isFinite(prima.fineMs) || !Number.isFinite(dopo.fineMs) || prima.fineMs >= dopo.fineMs) {
    return { stato: "non_confrontabile", motivo: "ordine_non_valido" };
  }

  const primaPerIp = hostPerIp(prima.host);
  const dopoPerIp = hostPerIp(dopo.host);
  const primaVerificati = new Set(prima.ipVerificati);
  const dopoVerificati = new Set(dopo.ipVerificati);
  // Anche un MAC già visto a un altro IP rende incerta la novità dell'apparato.
  const macGiaVisti = contaMac(prima.host);
  const macAttuali = contaMac(dopo.host);
  const eventi: EventoConfrontoGiri[] = [];

  for (const ip of [...dopoPerIp.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const attuale = dopoPerIp.get(ip);
    if (!attuale || !primaVerificati.has(ip) || !dopoVerificati.has(ip)) continue;
    const mac = macOsservato(attuale.mac);
    const precedente = primaPerIp.get(ip);
    const macStabile = mac && (Number.parseInt(mac.slice(0, 2), 16) & 2) === 0 ? mac : null;
    if (!primaPerIp.has(ip)) {
      if (macStabile && macAttuali.get(macStabile) === 1 && !macGiaVisti.has(macStabile)) {
        eventi.push({ tipo: "host_nuovo", ip, mac: macStabile });
      }
      continue;
    }
    if (!precedente) continue;
    const macPrima = macOsservato(precedente.mac);
    if (mac && macPrima && mac !== macPrima) {
      eventi.push({ tipo: "mac_cambiato", ip, prima: macPrima, dopo: mac });
      continue; // Le porte del precedente apparato non sono la baseline del successivo.
    }
    if (!macStabile || macPrima !== macStabile || macGiaVisti.get(macStabile) !== 1 || macAttuali.get(macStabile) !== 1) continue;

    const vecchie = portePerChiave(precedente.porte);
    const nuove = [...portePerChiave(attuale.porte)].sort(([, a], [, b]) =>
      a.porta - b.porta || a.protocollo.localeCompare(b.protocollo));
    for (const [chiave, p] of nuove) {
      const esitoPrima = vecchie.get(chiave)?.esito;
      if (p.esito !== "aperta" || esitoPrima === "aperta") continue;
      eventi.push({
        tipo: esitoPrima === "chiusa" ? "porta_nuova" : "porta_rilevata",
        ip,
        protocollo: p.protocollo,
        porta: p.porta,
      });
    }
  }
  return { stato: "confrontabile", eventi };
}
