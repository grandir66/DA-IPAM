/**
 * Il traduttore MikroTik (RouterOS), spec topologia §13.6.1. Lato locale, righe di `/ip neighbor`: `ether3,bridge` →
 * `ether3`, nel bridge; `sfp28-1,bond1,‹bridge›` → fascio `bond1`, nel bridge (il bridge può avere un nome scelto dal
 * cliente); una porta fisica senza bridge → fuori dal bridge (instradata). Lato remoto, porta annunciata da un MikroTik:
 * `‹bridge›/ether3`, `‹bridge›/bond1/wlan60-1` → l'ultimo pezzo (RouterOS scrive «master/porta»). Fisica: le porte per
 * prefisso (erano `links.ts:57-66`: Task 1b della fase 2b e revisione finale M-7, `ether1-vlan20` non è fisica). Logica:
 * i nomi delle interfacce logiche, senza `wlan` e `wifi`, che sono senza fili. Un nome scelto dal cliente (per una VLAN, un
 * bridge, un tunnel) resta non noto finché non si legge il tipo dell'interfaccia (T2, MK2): mai una regola sul nome (I58).
 */
import type { PortaLetta } from "./traduci";

/**
 * Le porte fisiche: i nomi di fabbrica `ether1`, `sfp-sfpplus1`, `sfp28-1`, `sfp1`, `combo1`, `bond1` (un fascio verso un
 * apparato) e `qsfp28-1-1` (la corsia di una QSFP), seguiti al più da una velocità che non si confonde con un numero di
 * VLAN: con la «g» (`-10g`, `-2.5g`) oppure `-2.5` (la porta a 2,5G rinominata così sul cliente A, `ether1-2.5`). Un intero
 * nudo (`ether1-20`) o un numero col punto (`ether5-1.20`) è un nome scelto, come una VLAN: non è fisico. Verifica del 15/10
 * (vincolo 9): con «qualunque coda di cifre» una VLAN chiamata `ether1-20` su un'altra rete passava per una porta fisica, e
 * le righe del router su di lei davano cavi (H7). Sulle due copie del 14/10 la restrizione non cambia nessun nome.
 */
export const MIKROTIK_FISICA = /^((ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\d+|qsfp\w*?-?\d+(-[1-8])?)(-(\d+(\.\d+)?g|2\.5))?$/;
/** I nomi di fabbrica dei tunnel di RouterOS (spec §13.7.5): senza il tipo letto, solo questi dicono «tunnel»; un nome scelto resta non noto. */
export const MIKROTIK_TUNNEL = /^(eoip-tunnel|gre-tunnel|ipip-tunnel|6to4-tunnel|wireguard|ovpn-out|ovpn-in|l2tp-out|l2tp-in|sstp-out|sstp-in|pptp-out|pptp-in)\d+$/;
const MIKROTIK_RINOMINATA = /^(ether|sfp-sfpplus|sfp28-|sfp|combo|qsfp\w*?-?|bond)\d+-/;
const LOGICA = /^(bridge|vlan|vrrp|eoip|gre|ipip|6to4|vxlan|wg|wireguard|ovpn|pppoe|pptp|l2tp|sstp|lte|lo$|loopback|veth)/;
const SENZA_FILI = /^(wlan|wifi)/;
const FASCIO = /^bond\d+$/i;

function fatti(nome: string): Pick<PortaLetta, "fisica" | "senzaFili"> {
  const p = nome.toLowerCase();
  if (p === "") return { fisica: null, senzaFili: null };
  if (SENZA_FILI.test(p)) return { fisica: false, senzaFili: true };
  if (LOGICA.test(p)) return { fisica: false, senzaFili: false };
  if (MIKROTIK_FISICA.test(p)) return { fisica: true, senzaFili: false };
  if (MIKROTIK_RINOMINATA.test(p) || p.includes(".")) return { fisica: false, senzaFili: false };
  return { fisica: null, senzaFili: null };
}

export function traduciMikrotikLocale(grezzo: string): PortaLetta {
  const [primo, ...resto] = grezzo.split(",").map((s) => s.trim());
  const f = fatti(primo);
  // «porta,fascio,bridge»: l'ultimo pezzo è il padrone più in alto; un fascio senza bridge sopra non è nel bridge.
  const nelBridge = resto.length > 0 ? !FASCIO.test(resto[resto.length - 1]) : f.fisica === true ? false : null;
  const fascio = resto.find((r) => FASCIO.test(r)) ?? (resto.length >= 2 ? resto[0] : null);
  return { nome: primo, ...f, nelBridge, fascio };
}

export function traduciMikrotikRemoto(grezzo: string): PortaLetta {
  const pezzi = grezzo.split("/").map((s) => s.trim());
  const nome = pezzi[pezzi.length - 1];
  const fascio = pezzi.slice(0, -1).find((p) => FASCIO.test(p)) ?? null;
  return { nome, ...fatti(nome), nelBridge: pezzi.length > 1 ? true : null, fascio };
}
