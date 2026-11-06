/**
 * Freno della pagina Scansioni VA (06/11/2026). Al 72729 i PLC delle celle frigo sono spariti due
 * volte durante una scansione della loro rete: la coincidenza non è una prova, ma una pagina che
 * lancia su più reti con un clic non può passarci sopra. Finché Edge non sa escludere i singoli
 * host, una rete con un impianto non si lancia da qui.
 *
 * Si tratta come impianto anche nel dubbio: costruttori e porte sono gli stessi del riconoscimento
 * degli `unknown`, che tiene `-O` lontano da quegli apparati. Limite: vede solo ciò che l'inventario
 * conosce. Una rete mai rilevata non ha host e passa.
 */
import { PORTE_DI_CAMPO, PRODUTTORE_DI_CAMPO } from "@/lib/scanner/profili/sconosciuti";

const CATEGORIE_IMPIANTO = new Set(["plc", "hmi", "iot", "rete_ot", "sensore"]);
const PORTE = new Set(PORTE_DI_CAMPO);
const ESEMPI = 5;

export const MOTIVO_IMPIANTO = "Impianto in rete: una scansione può fermarlo";

export interface HostPerImpianti {
  network_id: number;
  ip: string;
  classification?: string | null;
  vendor?: string | null;
  device_manufacturer?: string | null;
  inferred_vendor?: string | null;
  attr_vendor_name?: string | null;
  open_ports?: string | null;
  custom_name?: string | null;
  hostname?: string | null;
}

/** Un JSON illeggibile non dice niente sulle porte: restano categoria e costruttore. */
function haPortaDiCampo(openPorts: string | null | undefined): boolean {
  if (!openPorts) return false;
  try {
    const porte: unknown = JSON.parse(openPorts);
    return Array.isArray(porte) && porte.some((p) => PORTE.has(Number((p as { port?: unknown })?.port)));
  } catch {
    return false;
  }
}

export function eImpianto(h: Omit<HostPerImpianti, "network_id" | "ip">): boolean {
  if (CATEGORIE_IMPIANTO.has((h.classification ?? "").trim())) return true;
  const produttore = [h.vendor, h.device_manufacturer, h.inferred_vendor, h.attr_vendor_name].filter(Boolean).join(" ");
  return PRODUTTORE_DI_CAMPO.test(produttore) || haPortaDiCampo(h.open_ports);
}

export interface ImpiantiRete {
  host: number;
  esempi: string[];
}

export function impiantiDellaRete(hosts: readonly HostPerImpianti[]): ImpiantiRete {
  const trovati = hosts.filter(eImpianto);
  return {
    host: trovati.length,
    esempi: trovati.slice(0, ESEMPI).map((h) => [h.ip, h.custom_name || h.hostname].filter(Boolean).join(" ")),
  };
}

export function impiantiPerRete(hosts: readonly HostPerImpianti[]): Map<number, ImpiantiRete> {
  const gruppi = new Map<number, HostPerImpianti[]>();
  for (const h of hosts) {
    const g = gruppi.get(h.network_id);
    if (g) g.push(h);
    else gruppi.set(h.network_id, [h]);
  }
  const esito = new Map<number, ImpiantiRete>();
  for (const [id, g] of gruppi) {
    const r = impiantiDellaRete(g);
    if (r.host > 0) esito.set(id, r);
  }
  return esito;
}
