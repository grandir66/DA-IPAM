/**
 * Traduce la `category` libera di `SysObjMatch` in un `DeviceClassification` valido.
 *
 * La lookup table `snmp-sysobj-lookup.ts` usa categorie storiche ("networking",
 * "wireless") che NON sono slug di classificazione: usarle direttamente produce
 * valori non renderizzabili in UI. Qui vengono normalizzate, disambiguando
 * switch/router dal nome prodotto quando la categoria da sola non basta.
 *
 * Ritorna `undefined` quando il prodotto è genuinamente ambiguo: la cascade di
 * discovery.ts prosegue con i livelli successivi invece di fissare uno slug sbagliato.
 */
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";
import type { DeviceClassification } from "@/lib/device-classifier";
import type { SysObjMatch } from "@/lib/scanner/snmp-sysobj-lookup";

const VALID = new Set<string>(DEVICE_CLASSIFICATIONS);

/** Linee prodotto inequivocabilmente switch. Valutate PRIMA dei router: "Cloud Router Switch" è uno switch. */
const SWITCH_PRODUCT = /switch|catalyst|procurve|comware|aos-cx|\bcrs\b|\busw\b|tl-sg|m4[13]00|hp\s*19[12]0/i;
/** Linee prodotto inequivocabilmente router/gateway. */
const ROUTER_PRODUCT = /router|\bisr\b|\basr\b|\bccr\b|\brb\d|hex|hap|dream\s*machine|\budm\b|gateway/i;

export function mapSysObjCategory(match: SysObjMatch): DeviceClassification | undefined {
  const category = match.category?.trim().toLowerCase() ?? "";
  const product = match.product ?? "";

  if (category === "wireless") return "access_point";

  if (category === "networking") {
    if (SWITCH_PRODUCT.test(product)) return "switch";
    if (ROUTER_PRODUCT.test(product)) return "router";
    return undefined;
  }

  return VALID.has(category) ? (category as DeviceClassification) : undefined;
}
