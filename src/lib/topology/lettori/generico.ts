/**
 * Il traduttore generico, per un prodotto senza traduttore suo: il nome resta com'è e dal nome si sa solo ciò che vale
 * per ogni prodotto (le regole comuni di `links.ts:75-83` di prima, senza le forme MikroTik): un nome da interfaccia
 * logica comune (bridge, VLAN, VRRP, tunnel, loopback) o con «,» o «.» (una sottointerfaccia, «Gi0/1.10») non è un
 * cavo; «wlan»/«wifi» è senza fili; il resto è non noto.
 */
import type { PortaLetta } from "./traduci";

export const LOGICA_COMUNE = /^(bridge|vlan|vrrp|eoip|gre|ipip|6to4|vxlan|wg|wireguard|ovpn|pppoe|pptp|l2tp|sstp|lte|lo$|loopback|veth)/;
const SENZA_FILI = /^(wlan|wifi)/;

export function traduciGenerico(nome: string): PortaLetta {
  const p = nome.toLowerCase();
  const base = { nome, nelBridge: null, fascio: null };
  if (p === "") return { ...base, fisica: null, senzaFili: null };
  if (SENZA_FILI.test(p)) return { ...base, fisica: false, senzaFili: true };
  if (LOGICA_COMUNE.test(p) || p.includes(",") || p.includes(".")) return { ...base, fisica: false, senzaFili: false };
  return { ...base, fisica: null, senzaFili: null };
}
