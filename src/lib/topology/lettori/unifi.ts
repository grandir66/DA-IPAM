/**
 * Il traduttore del controller UniFi (spec topologia §13.1 punto 9, §13.6.1). Lato locale: nella tabella LLDP il
 * controller chiama «SFP_ N» la porta che nell'elenco delle porte è «SFP+ N», anche con la descrizione («SFP_ 17 - x» è
 * «SFP+ 17 - x»); «SFP_ 1» NON è «SFP 1», un'altra porta. Ogni porta del `port_table` è fisica; le interfacce radio di
 * un access point («wifi…», «ra…», «ath…», «wlan…») sono senza fili. Il «local » davanti lo toglie già il lettore
 * (`unifi-map.ts:159-163`). Da T3 la porta si prende dall'indice (`local_port_idx`).
 */
import type { PortaLetta } from "./traduci";

const RADIO = /^(wifi|ra|ath|wlan)\d/i;

export function traduciUnifiLocale(grezzo: string): PortaLetta {
  const nome = grezzo.trim().replace(/^SFP_(?=\s)/i, "SFP+");
  if (nome === "") return { nome, fisica: null, senzaFili: null, nelBridge: null, fascio: null };
  if (RADIO.test(nome)) return { nome, fisica: false, senzaFili: true, nelBridge: null, fascio: null };
  return { nome, fisica: true, senzaFili: false, nelBridge: null, fascio: null };
}
