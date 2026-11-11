/**
 * Proposta di profilo per device (Riccardo, 06/11/2026). Funzione pura: tutte le regole stanno qui.
 *
 * Regole che non si discutono: nel dubbio si scende; un impianto non riceve profili; una proposta
 * non lancia niente. Tipo sconosciuto, conteso o a bassa confidenza finisce in «da chiarire» e resta
 * alla sola ricognizione. La scelta manuale di una persona vince sull'attribuzione, ma non sul freno.
 */
import { getDeviceCategoryGroup } from "@/lib/device-classifications";
import { eImpianto, type HostPerImpianti } from "@/lib/vuln/impianti-in-rete";
import type { IdVoce } from "@/lib/vuln/scansioni-va-regole";

export type Famiglia = "rete" | "windows" | "linux" | "web" | "periferiche" | "impianti" | "da_chiarire";

export const ETICHETTE_FAMIGLIA: Record<Famiglia, string> = {
  rete: "Rete",
  windows: "Windows",
  linux: "Linux e server",
  web: "Web e applicazioni",
  periferiche: "Periferiche",
  impianti: "IoT e OT",
  da_chiarire: "Da chiarire",
};

/** Profilo proposto per famiglia; `null` = nessuna scansione VA. */
const VOCE_DI_FAMIGLIA: Record<Famiglia, IdVoce | null> = {
  rete: "bilanciato",
  windows: "bilanciato",
  linux: "bilanciato",
  web: "bilanciato",
  periferiche: "veloce",
  impianti: null,
  da_chiarire: null,
};

/** Il profilo di una famiglia; `null` = nessuna scansione VA (impianti, da chiarire). */
export function voceDiFamiglia(f: Famiglia): IdVoce | null {
  return VOCE_DI_FAMIGLIA[f];
}

export interface HostPerProposta extends HostPerImpianti {
  attr_confidence_category?: number | null;
  attr_os_family?: string | null;
  os_info?: string | null;
  classification_manual?: number | null;
}

export interface Proposta {
  famiglia: Famiglia;
  voce: IdVoce | null;
  /** Ha servizi web: nuclei e il profilo web si aggiungono a quello della famiglia. */
  conWeb: boolean;
  confidenza: "alta" | "bassa";
  motivo: string;
}

/** Sotto questa confidenza l'attribuzione non basta a dare un profilo: si usa la classificazione. */
export const CONFIDENZA_MINIMA = 60;

const PORTE_WEB = new Set([80, 443, 8000, 8080, 8443, 8888, 9443]);

function porteDi(openPorts: string | null | undefined): Set<number> {
  if (!openPorts) return new Set();
  try {
    const p: unknown = JSON.parse(openPorts);
    return Array.isArray(p) ? new Set(p.map((x) => Number((x as { port?: unknown })?.port))) : new Set();
  } catch {
    return new Set();
  }
}

function proposta(famiglia: Famiglia, confidenza: Proposta["confidenza"], motivo: string, conWeb = false): Proposta {
  return { famiglia, voce: VOCE_DI_FAMIGLIA[famiglia], conWeb, confidenza, motivo };
}

/** Di quale sistema è un computer: prima ciò che è stato letto, poi le porte. */
function sistemaDi(h: HostPerProposta, porte: Set<number>): { famiglia: "windows" | "linux"; da: string } | null {
  const testo = `${h.attr_os_family ?? ""} ${h.os_info ?? ""}`.toLowerCase();
  if (testo.includes("windows")) return { famiglia: "windows", da: "sistema operativo letto" };
  if (/linux|ubuntu|debian|centos|red hat|proxmox|unix|bsd/.test(testo)) return { famiglia: "linux", da: "sistema operativo letto" };
  if ([135, 445, 3389, 5985, 5986].some((p) => porte.has(p))) return { famiglia: "windows", da: "porte Windows aperte" };
  if (porte.has(22)) return { famiglia: "linux", da: "SSH aperto" };
  return null;
}

/** La categoria da usare e da dove viene. `null` = non abbastanza sicura per dare un profilo. */
function categoriaDi(h: HostPerProposta): { radice: string; foglia: string } | null {
  const manuale = Number(h.classification_manual ?? 0) === 1;
  const attr = (h.attr_category ?? "").trim();
  if (!manuale && attr && attr !== "unknown" && Number(h.attr_confidence_category ?? 0) >= CONFIDENZA_MINIMA) {
    const [radice, foglia = ""] = attr.split(".");
    return { radice, foglia };
  }
  const c = (h.classification ?? "").trim();
  if (!c || c === "unknown") return null;
  const gruppo = getDeviceCategoryGroup(c);
  if (gruppo === "unknown") return null;
  // 11/11/2026: le categorie del catalogo sono cambiate (dieci invece di sei). Le radici che escono da qui
  // sono le stesse di prima, classe per classe: lo smartphone resta «compute» anche se ora sta in Telefonia.
  if (gruppo === "rete") return { radice: "network", foglia: c };
  if (gruppo === "archiviazione") return /^nas/.test(c) ? { radice: "storage", foglia: "nas" } : { radice: "peripheral", foglia: c };
  if (gruppo === "stampa" || gruppo === "video" || gruppo === "alimentazione") return { radice: "peripheral", foglia: c };
  if (gruppo === "telefonia" && c !== "smartphone") return { radice: "peripheral", foglia: c };
  if (gruppo === "ot" || gruppo === "iot") return { radice: "iot", foglia: c };
  return { radice: "compute", foglia: c === "hypervisor" ? "hypervisor" : c };
}

export function proponiProfilo(h: HostPerProposta, opzioni: { conteso?: boolean } = {}): Proposta {
  // Prima di tutto, anche contro una scelta manuale: il freno non si discute da qui.
  if (eImpianto(h)) return proposta("impianti", "alta", "Apparato di campo: solo dati passivi");

  const manuale = Number(h.classification_manual ?? 0) === 1;
  if (opzioni.conteso && !manuale) return proposta("da_chiarire", "bassa", "Le fonti non concordano sul tipo o sul sistema");

  const categoria = categoriaDi(h);
  if (!categoria) return proposta("da_chiarire", "bassa", "Tipo non riconosciuto");

  const porte = porteDi(h.open_ports);
  const conWeb = [...porte].some((p) => PORTE_WEB.has(p));
  const confidenza: Proposta["confidenza"] = manuale || Number(h.attr_confidence_category ?? 0) >= CONFIDENZA_MINIMA ? "alta" : "bassa";

  switch (categoria.radice) {
    case "network":
      return proposta("rete", confidenza, `Apparato di rete: ${categoria.foglia || "tipo generico"}`, conWeb);
    case "storage":
      return proposta("linux", confidenza, "Storage di rete", conWeb);
    case "peripheral":
    case "av":
    case "voip":
    case "power":
    case "mobile":
      return proposta("periferiche", confidenza, `Periferica: ${categoria.foglia || categoria.radice}`, conWeb);
    case "iot":
    case "ot":
      return proposta("impianti", "alta", "Apparato IoT o di campo: solo dati passivi");
    case "compute": {
      if (categoria.foglia === "hypervisor") return proposta("linux", confidenza, "Hypervisor", conWeb);
      const sistema = sistemaDi(h, porte);
      if (sistema) return proposta(sistema.famiglia, confidenza, `Computer: ${sistema.da}`, conWeb);
      if (conWeb) return proposta("web", "bassa", "Servizi web, sistema non riconosciuto", true);
      return proposta("da_chiarire", "bassa", "Computer senza sistema né porte note");
    }
    default:
      return proposta("da_chiarire", "bassa", "Tipo non riconosciuto");
  }
}
