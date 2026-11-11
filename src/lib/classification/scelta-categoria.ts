/**
 * Scegliere una categoria in fretta (Riccardo, 11/11/2026: «un oggetto che non è device deve essere possibile
 * assegnarlo a una categoria in modo efficace»). Prima la scelta era un elenco piatto di 52 voci in ordine
 * alfabetico. Qui: le stesse voci raccolte nei gruppi che il catalogo ha già, con la ricerca. Modulo puro.
 */
import {
  DEVICE_CATEGORY_GROUP_COSA,
  DEVICE_CATEGORY_GROUP_LABELS,
  DEVICE_CATEGORY_GROUP_ORDER,
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  getDeviceCategoryGroup,
  type DeviceCategoryGroup,
} from "@/lib/device-classifications";

export interface VoceScelta { slug: string; etichetta: string }
export interface GruppoScelta { gruppo: DeviceCategoryGroup | "cliente"; titolo: string; cosa?: string; voci: VoceScelta[] }

const TITOLO_CLIENTE = "Categorie del cliente";

const ORDINE: readonly DeviceCategoryGroup[] = DEVICE_CATEGORY_GROUP_ORDER;

function piatto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** I gruppi con le loro voci, in ordine d'uso. Con `cerca`, restano solo le voci che lo contengono (nome o gruppo). */
export function gruppiScelta(cerca: string = "", extra: readonly VoceScelta[] = []): GruppoScelta[] {
  const q = piatto(cerca);
  const perGruppo = new Map<DeviceCategoryGroup, VoceScelta[]>();
  for (const slug of DEVICE_CLASSIFICATIONS_ORDERED) {
    if (!slug || slug === "unknown") continue;
    const gruppo = getDeviceCategoryGroup(slug);
    if (gruppo === "unknown") continue;
    const etichetta = getClassificationLabel(slug);
    const titolo = DEVICE_CATEGORY_GROUP_LABELS[gruppo];
    if (q && !piatto(etichetta).includes(q) && !piatto(slug).includes(q) && !piatto(titolo).includes(q)) continue;
    const voci = perGruppo.get(gruppo) ?? [];
    if (!voci.some((v) => v.slug === slug)) voci.push({ slug, etichetta });
    perGruppo.set(gruppo, voci);
  }
  const gruppi: GruppoScelta[] = ORDINE.filter((g) => perGruppo.has(g)).map((g) => ({
    gruppo: g,
    titolo: DEVICE_CATEGORY_GROUP_LABELS[g],
    cosa: DEVICE_CATEGORY_GROUP_COSA[g],
    voci: (perGruppo.get(g) ?? []).sort((a, b) => a.etichetta.localeCompare(b.etichetta, "it")),
  }));
  // Le categorie aggiunte dal cliente (Impostazioni, Classificazioni) non stanno nel catalogo: un gruppo loro, in fondo.
  const gia = new Set(gruppi.flatMap((g) => g.voci.map((v) => v.slug)));
  const delCliente = extra
    .filter((v) => v.slug && v.slug !== "unknown" && !gia.has(v.slug))
    .filter((v) => !q || piatto(v.etichetta).includes(q) || piatto(v.slug).includes(q) || piatto(TITOLO_CLIENTE).includes(q))
    .sort((a, b) => a.etichetta.localeCompare(b.etichetta, "it"));
  if (delCliente.length > 0) gruppi.push({ gruppo: "cliente", titolo: TITOLO_CLIENTE, voci: delCliente });
  return gruppi;
}

/**
 * Filtro a due livelli (11/11/2026): il valore `gruppo:<categoria>` prende tutte le classi di quella categoria,
 * uno slug prende solo quella classe. Vuoto o «all» prende tutto.
 */
export const PREFISSO_GRUPPO = "gruppo:";

export function passaFiltroCategoria(filtro: string | null | undefined, classe: string | null | undefined): boolean {
  if (!filtro || filtro === "all") return true;
  if (filtro.startsWith(PREFISSO_GRUPPO)) return getDeviceCategoryGroup(classe) === filtro.slice(PREFISSO_GRUPPO.length);
  return (classe ?? "") === filtro;
}

/**
 * Da dove viene la categoria che si vede, in parole. `fase` è `hosts.attr_min_phase`; una scelta a mano vince.
 * Una fase che non conosciamo non dice niente: meglio niente che una parola inventata.
 */
export function origineCategoria(aMano: boolean, fase: string | null | undefined): string | null {
  if (aMano) return "a mano";
  switch (fase) {
    case "scan_icmp": return "da nome e scheda di rete";
    case "scan_naabu":
    case "scan_nmap_base":
    case "scan_profilo": return "dalle porte";
    case "scan_snmp_verify": return "da SNMP";
    case "credential_validate": return "dall'accesso";
    case "integration": return "da AD e altri sistemi";
    case "manual": return "a mano";
    default: return null;
  }
}
